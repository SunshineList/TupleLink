const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htdocs = path.join(__dirname, '../../openwrt/htdocs');

function load(name, protocol = 'http:') {
  const polls = [];
  const calls = [];
  const fetchCalls = [];
  let authorized = true;
  let result = { running: true, listen: '192.168.8.1:9080', checks: [] };
  const context = vm.createContext({
    window: { location: { protocol } },
    L: { env: { sessionid: '1234567890abcdef1234567890abcdef' } },
    fetch: async (url, options) => { fetchCalls.push([url, options]); return {ok: authorized}; },
    view: { extend: value => value },
    rpc: { declare: spec => async (...args) => { calls.push([spec.method, ...args]); return result; } },
    poll: { add: fn => polls.push(fn) },
    ui: { createHandlerFn: (self, fn) => fn.bind(self), addNotification: () => {} },
    dom: { content: (node, content) => { node.children = content; } },
    E: (tag, attrs, children) => ({ tag, attrs, children }),
  });
  vm.runInContext("String.prototype.format = function(...args) { let i=0; return this.replace(/%s/g, () => args[i++]); };", context);
  const view = vm.runInContext('(function(){' + fs.readFileSync(path.join(htdocs, name + '.js'), 'utf8') + '\n})()', context);
  return { view, polls, calls, fetchCalls, setAuthorized: value => { authorized = value; }, setResult: value => { result = value; } };
}

function elements(node, tag) {
  if (!node || typeof node !== 'object') return [];
  return (node.tag === tag ? [node] : []).concat((Array.isArray(node.children) ? node.children : [node.children]).flatMap(child => elements(child, tag)));
}

test('all LuCI modules parse in the actual function-wrapper convention', () => {
  for (const file of fs.readdirSync(htdocs)) new Function(fs.readFileSync(path.join(htdocs, file), 'utf8'));
});

test('Daed menu only has dashboard and logs, defaulting to dashboard', () => {
  const menu = JSON.parse(fs.readFileSync(path.join(__dirname, '../../openwrt/files/menu.json')));
  assert.deepEqual(Object.keys(menu).sort(), ['admin/services/daed', 'admin/services/daed/dashboard', 'admin/services/daed/logs']);
  assert.ok(menu['admin/services/daed/dashboard'].order < menu['admin/services/daed/logs'].order);
});

test('HTTP and HTTPS dashboards embed the authenticated same-origin gateway', () => {
  for (const protocol of ['http:', 'https:']) {
    const { view } = load('dashboard', protocol);
    const tree = view.render({ running: true, authorized: true });
    assert.equal(elements(tree, 'iframe')[0].attrs.src, '/cgi-bin/daed-router/');
    assert.equal(elements(tree, 'a').length, 0);
    assert.equal(elements(tree, 'h2').length, 0);
  }
});

test('stopped services and expired sessions never embed a bypass URL', () => {
  const { view } = load('dashboard');
  for (const data of [{ running: false }, { running: true, authorized: false }]) {
    assert.equal(elements(view.render(data), 'iframe').length, 0);
  }
});

test('dashboard authorizes using the LuCI session in a same-origin POST body', async () => {
  const module = load('dashboard');
  const data = await module.view.load();
  assert.equal(data.authorized, true);
  const [url, options] = module.fetchCalls[0];
  assert.equal(url, '/cgi-bin/daed-router/session');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.method, 'POST');
  assert.equal(JSON.parse(options.body).session, '1234567890abcdef1234567890abcdef');
});

test('rejected bootstrap cannot render the management iframe', async () => {
  const module = load('dashboard');
  module.setAuthorized(false);
  const data = await module.view.load();
  assert.equal(elements(module.view.render(data), 'iframe').length, 0);
});

test('logs are rendered as text instead of executable HTML', async () => {
  const module = load('logs');
  const tree = module.view.render();
  module.setResult({ logs: '<script>alert(1)</script>' });
  await module.polls[0]();
  assert.equal(elements(tree, 'pre')[0].textContent, '<script>alert(1)</script>');
});
