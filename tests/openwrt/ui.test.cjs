const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htdocs = path.join(__dirname, '../../openwrt/htdocs');

function load(name, protocol = 'http:') {
  const polls = [];
  const calls = [];
  let result = { running: true, listen: '192.168.8.1:9080', checks: [] };
  const context = vm.createContext({
    window: { location: { protocol } },
    view: { extend: value => value },
    rpc: { declare: spec => async (...args) => { calls.push([spec.method, ...args]); return result; } },
    poll: { add: fn => polls.push(fn) },
    ui: { createHandlerFn: (self, fn) => fn.bind(self), addNotification: () => {} },
    dom: { content: (node, content) => { node.children = content; } },
    E: (tag, attrs, children) => ({ tag, attrs, children }),
  });
  vm.runInContext("String.prototype.format = function(...args) { let i=0; return this.replace(/%s/g, () => args[i++]); };", context);
  const view = vm.runInContext('(function(){' + fs.readFileSync(path.join(htdocs, name + '.js'), 'utf8') + '\n})()', context);
  return { view, polls, calls, setResult: value => { result = value; } };
}

function elements(node, tag) {
  if (!node || typeof node !== 'object') return [];
  return (node.tag === tag ? [node] : []).concat((Array.isArray(node.children) ? node.children : [node.children]).flatMap(child => elements(child, tag)));
}

test('all LuCI modules parse in the actual function-wrapper convention', () => {
  for (const file of fs.readdirSync(htdocs)) new Function(fs.readFileSync(path.join(htdocs, file), 'utf8'));
});

test('HTTP dashboard uses the actual LAN address and custom port', () => {
  const { view } = load('dashboard');
  const tree = view.render({ running: true, listen: '192.168.8.1:9080' });
  assert.equal(elements(tree, 'iframe')[0].attrs.src, 'http://192.168.8.1:9080/');
  assert.equal(elements(tree, 'a')[0].attrs.rel, 'noopener noreferrer');
});

test('HTTPS LuCI never embeds mixed-content HTTP', () => {
  const { view } = load('dashboard', 'https:');
  const tree = view.render({ running: true, listen: '192.168.8.1:2023' });
  assert.equal(elements(tree, 'iframe').length, 0);
  assert.equal(elements(tree, 'a').length, 1);
});

test('stopped, loopback and malformed endpoints do not create an iframe or unsafe link', () => {
  const { view } = load('dashboard');
  for (const data of [
    { running: false, listen: '192.168.8.1:2023' },
    { running: true, listen: '127.0.0.1:2023' },
    { running: true, listen: 'javascript:alert(1)' },
  ]) {
    assert.equal(elements(view.render(data), 'iframe').length, 0);
    assert.equal(elements(view.render(data), 'a').length, 0);
  }
});

test('overview renders capability results and invokes only a fixed service action', async () => {
  const module = load('overview');
  const tree = module.view.render();
  module.setResult({ firmware: 'iStoreOS', release: 'test', architecture: 'aarch64', kernel: '6.6', version: '0.1.0', running: false, checks: [{ name: 'btf', status: 'error', message: 'missing' }] });
  await module.polls[0]();
  assert.ok(elements(tree, 'td').some(node => node.children === '不满足'));
  module.setResult({ success: true, checks: [] });
  await elements(tree, 'button')[1].attrs.click();
  assert.ok(module.calls.some(call => call[0] === 'action' && call[1] === 'stop'));
});

test('logs are rendered as text instead of executable HTML', async () => {
  const module = load('logs');
  const tree = module.view.render();
  module.setResult({ logs: '<script>alert(1)</script>' });
  await module.polls[0]();
  assert.equal(elements(tree, 'pre')[0].textContent, '<script>alert(1)</script>');
});
