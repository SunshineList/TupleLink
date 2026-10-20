const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htdocs = path.join(__dirname, '../../openwrt/htdocs');
const menu = JSON.parse(fs.readFileSync(path.join(__dirname, '../../openwrt/files/menu.json')));
const panelModule = menu['admin/services/daed/dashboard'].action.path.split('/').pop();

function load(name, protocol = 'http:', page = 'dashboard') {
  const polls = [];
  const calls = [];
  const fetchCalls = [];
  let authorized = true;
  let rpcFailure = false;
  let result = { running: true, listen: '127.0.0.1:2023', checks: [] };
  const context = vm.createContext({
    window: { location: { protocol, pathname: '/cgi-bin/luci/admin/services/daed/' + page } },
    L: { env: { sessionid: '1234567890abcdef1234567890abcdef' } },
    fetch: async (url, options) => { fetchCalls.push([url, options]); return {ok: authorized}; },
    view: { extend: value => value },
    baseclass: { extend: value => value },
    rpc: { declare: spec => async (...args) => { calls.push([spec.method, ...args]); if (rpcFailure) throw new Error('read failed'); return result; } },
    poll: { add: (fn, interval) => { fn.interval = interval; polls.push(fn); } },
    ui: { createHandlerFn: (self, fn) => fn.bind(self), addNotification: () => {} },
    dom: { content: (node, content) => { node.children = content; } },
    E: (tag, attrs, children) => {
      const node = { tag, attrs, children, style: {}, scrollTop: 0, scrollHeight: 1000, clientHeight: 200 };
      Object.defineProperty(node,'textContent',{
        get(){ return (Array.isArray(this.children) ? this.children : [this.children]).map(child=>typeof child==='object' ? child?.textContent || '' : child || '').join(''); },
        set(value){ this.children = String(value); },
      });
      return node;
    },
  });
  vm.runInContext("String.prototype.format = function(...args) { let i=0; return this.replace(/%s/g, () => args[i++]); };", context);
  context.community = vm.runInContext('(function(){' + fs.readFileSync(path.join(htdocs, 'community.js'), 'utf8') + '\n})()', context);
  const view = vm.runInContext('(function(){' + fs.readFileSync(path.join(htdocs, name + '.js'), 'utf8') + '\n})()', context);
  return { view, polls, calls, fetchCalls, setAuthorized: value => { authorized = value; }, setResult: value => { result = value; }, setFailure: value => { rpcFailure = value; } };
}

function elements(node, tag) {
  if (!node || typeof node !== 'object') return [];
  return (node.tag === tag ? [node] : []).concat((Array.isArray(node.children) ? node.children : [node.children]).flatMap(child => elements(child, tag)));
}

test('all LuCI modules parse in the actual function-wrapper convention', () => {
  for (const file of fs.readdirSync(htdocs)) new Function(fs.readFileSync(path.join(htdocs, file), 'utf8'));
});

test('Daed menu exposes four ordered pages, defaulting to dashboard', () => {
  const entries = Object.entries(menu).filter(([key]) => key !== 'admin/services/daed').sort((a,b) => a[1].order - b[1].order);
  assert.deepEqual(entries.map(([key]) => key.split('/').pop()), ['dashboard', 'resources', 'advanced', 'logs']);
  assert.deepEqual(entries.map(([,entry]) => entry.title), ['管理面板','节点和订阅','高级设置','运行日志']);
});

test('native resource and advanced tabs embed their fixed same-origin route', () => {
  for (const page of ['resources', 'advanced']) {
    const { view } = load(panelModule, 'https:', page);
    assert.equal(elements(view.render({running:true,authorized:true}), 'iframe')[0].attrs.src, '/cgi-bin/daed-router/#/' + page);
  }
  const {view} = load(panelModule, 'https:', 'untrusted');
  assert.equal(elements(view.render({running:true,authorized:true}), 'iframe')[0].attrs.src, '/cgi-bin/daed-router/');
});

test('upgraded menu bypasses the cached pre-gateway dashboard and resolves every view', () => {
  assert.notEqual(menu['admin/services/daed/dashboard'].action.path, 'daed-router/dashboard');
  assert.notEqual(menu['admin/services/daed/dashboard'].action.path, 'daed-router/panel');
  assert.ok(fs.existsSync(path.join(htdocs,'panel.js')), 'Old cached menus still need a resolvable bootstrap view');
  for (const entry of Object.values(menu)) {
    if (entry.action.type !== 'view') continue;
    assert.equal(entry.action.path.split('/')[0], 'daed-router');
    assert.ok(fs.existsSync(path.join(htdocs, entry.action.path.split('/')[1] + '.js')));
  }
});

test('HTTP and HTTPS dashboards embed the authenticated same-origin gateway', () => {
  for (const protocol of ['http:', 'https:']) {
    const { view } = load(panelModule, protocol);
    const tree = view.render({ running: true, authorized: true });
    assert.equal(elements(tree, 'iframe')[0].attrs.src, '/cgi-bin/daed-router/');
    assert.equal(elements(tree, 'a').length, 0);
    assert.equal(elements(tree, 'h2').length, 0);
  }
});

test('stopped services and expired sessions never embed a bypass URL', () => {
  const { view } = load(panelModule);
  for (const data of [{ running: false }, { running: true, authorized: false }]) {
    assert.equal(elements(view.render(data), 'iframe').length, 0);
  }
});

test('dashboard authorizes using the LuCI session in a same-origin POST body', async () => {
  const module = load(panelModule);
  const data = await module.view.load();
  assert.equal(data.authorized, true);
  const [url, options] = module.fetchCalls[0];
  assert.equal(url, '/cgi-bin/daed-router/session');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.method, 'POST');
  assert.equal(JSON.parse(options.body).session, '1234567890abcdef1234567890abcdef');
});

test('rejected bootstrap cannot render the management iframe', async () => {
  const module = load(panelModule);
  module.setAuthorized(false);
  const data = await module.view.load();
  assert.equal(elements(module.view.render(data), 'iframe').length, 0);
});

test('logs are rendered as text instead of executable HTML', async () => {
  const module = load('logs');
  module.setResult({ logs: '<script>alert(1)</script>' });
  const tree = module.view.render();
  await module.polls[0]();
  assert.equal(elements(tree, 'pre')[0].textContent, '<script>alert(1)</script>');
});

test('native logs follow the tail, freeze history and resume to the latest bounded snapshot', async () => {
  const module = load('logs');
  module.setResult({ logs: 'old snapshot' });
  const tree = module.view.render();
  const output = elements(tree, 'pre')[0];
  const button = elements(tree, 'button')[0];
  assert.equal(module.polls[0].interval, 2);
  await module.polls[0]();
  assert.equal(output.scrollTop, output.scrollHeight);
  output.scrollTop = 100;
  output.attrs.scroll();
  assert.equal(button.textContent, '回到最新');
  module.setResult({ logs: 'rotated tail: new snapshot' });
  await module.polls[0]();
  assert.equal(output.textContent, 'old snapshot');
  assert.equal(output.scrollTop, 100);
  button.attrs.click();
  assert.equal(output.textContent, 'rotated tail: new snapshot');
  assert.equal(output.scrollTop, output.scrollHeight);
  assert.equal(button.textContent, '暂停跟随');
  button.attrs.click();
  module.setResult({ logs: 'keyboard latest' });
  await module.polls[0]();
  let prevented = false;
  output.attrs.keydown({key:'End', preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(output.textContent,'keyboard latest');
});

test('native log refresh errors preserve previous data and recover on the next successful poll', async () => {
  const module = load('logs');
  module.setResult({ logs:'last good snapshot' });
  const tree = module.view.render();
  await module.polls[0]();
  module.setFailure(true);
  await module.polls[0]();
  assert.equal(elements(tree,'pre')[0].textContent,'last good snapshot');
  const alert = elements(tree,'p').find(node=>node.attrs.role==='alert');
  assert.match(alert.textContent,/日志读取失败/);
  assert.equal(alert.style.display,'');
  module.setFailure(false);
  module.setResult({ logs:'recovered snapshot' });
  await module.polls[0]();
  assert.equal(elements(tree,'pre')[0].textContent,'recovered snapshot');
  assert.equal(alert.style.display,'none');
});

test('community links are reachable from logs and service fallback pages', () => {
  for (const name of ['logs', panelModule, 'panel']) {
    const module = load(name);
    const tree = name === 'logs' ? module.view.render() : module.view.render({running:false});
    const links = elements(tree, 'a');
    assert.deepEqual(links.map(link => link.attrs.href), ['https://www.youtube.com/@naiyou', 'https://t.me/naiyous']);
    for (const link of links) {
      assert.equal(link.attrs.target, '_blank');
      assert.equal(link.attrs.rel, 'noopener noreferrer');
      assert.ok(link.attrs['aria-label']);
    }
  }
});
