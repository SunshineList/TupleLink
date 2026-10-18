/* Run with native_panel.py. API-only; proxy start is fault-injected, never loads eBPF. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DAED_PANEL_URL || 'http://localhost:18080';
const controlDirectory = process.env.DAED_PANEL_CONTROL;
const output = process.env.DAED_PANEL_OUTPUT || '.build/panel-browser';
if (!controlDirectory) throw new Error('Set DAED_PANEL_CONTROL to native_panel.py --control');
fs.mkdirSync(output, { recursive: true });
async function control(action, extra = {}) {
  const id = Date.now();
  fs.writeFileSync(path.join(controlDirectory, 'command.json'), JSON.stringify({ id, action, ...extra }));
  for (let attempt = 0; attempt < 300; attempt++) {
    try { const response = JSON.parse(fs.readFileSync(path.join(controlDirectory, 'result.json'), 'utf8')); if (response.id === id) return response; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native fixture control timed out: ' + action);
}
async function login(page, url = base) {
  await page.goto(url + '/cgi-bin/luci/admin/services/daed', { waitUntil: 'domcontentloaded' });
  if (await page.locator('input[name=luci_username]').count()) {
    await page.locator('input[name=luci_username]').fill('root');
    await page.locator('input[name=luci_password]').fill('fixture-password');
    await page.getByRole('button', { name: /Log in|登录/ }).click();
  }
  await page.locator('iframe').waitFor();
  return page.frameLocator('iframe');
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.DAED_BROWSER_EXECUTABLE ? { executablePath: process.env.DAED_BROWSER_EXECUTABLE } : {}) });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', ignoreHTTPSErrors: true });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /@hello-pangea\/dnd|Invariant failed|nested scroll/.test(message.text())) errors.push(message.text()); });
    const frame = await login(page);
    await frame.getByRole('button', { name: '启动代理', exact: true }).waitFor({ timeout: 45000 });
    async function gql(query, variables = {}) {
      const response = await context.request.post(base + '/cgi-bin/daed-router/graphql', { headers: { Origin: base }, data: { query, variables } });
      assert.ok(response.ok(), 'Gateway returned HTTP ' + response.status());
      const body = await response.json();
      assert.ok(!body.errors, JSON.stringify(body.errors));
      return body.data;
    }
    const imported = await gql('mutation SeedNodes($args:[ImportArgument!]!){importNodes(rollbackError:true,args:$args){error node{id}}}', { args: Array.from({ length: 7 }, (_, index) => ({ tag: 'Legacy manual ' + (index + 1), link: `vless://33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}@192.0.2.${index + 20}:443?encryption=none&security=tls&type=tcp#Legacy-${index + 1}` })) });
    assert.ok(imported.importNodes.every(item => !item.error && item.node));
    const nodeIds = imported.importNodes.map(item => item.node.id);
    const group = await gql('mutation {createGroup(name:"LegacyGroup",policy:fixed,policyParams:[]){id}}');
    const groupId = group.createGroup.id;
    const sub = await gql('mutation {importSubscription(rollbackError:true,arg:{tag:"Legacy subscription",link:"http://127.0.0.1:18081/sub-a"}){sub{id} nodeImportResult{node{id}}}}');
    const subscriptionId = sub.importSubscription.sub.id;
    await gql('mutation BindNode($id:ID!,$nodes:[ID!]!){groupAddNodes(id:$id,nodeIDs:$nodes)}', { id: groupId, nodes: [nodeIds[0]] });
    await gql('mutation BindSubscription($id:ID!,$subs:[ID!]!){groupAddSubscriptions(id:$id,subscriptionIDs:$subs,nameFilterRegex:"HK")}', { id: groupId, subs: [subscriptionId] });
    await gql('mutation {setJsonStorage(paths:["ui-upgrade-preservation"],values:["retain-existing-storage"])}');
    const before = await gql('query {nodes{edges{id name tag link}} subscriptions{id tag link nodes{edges{id name}}} groups{id name policy nodes{id} subscriptions{subscription{id} nameFilterRegex}} configs{id name selected global{logLevel tproxyPort lanInterface wanInterface}} dnss{id name selected dns{string}} routings{id name selected routing{string}}}');
    const oldPreferences = await frame.locator('body').evaluate((_element, ids) => {
      localStorage.setItem('APP_STATEnodeSortableKeys', JSON.stringify([ids[1], ids[0]]));
      localStorage.setItem('APP_STATEcolsPerRow', '3');
      return { order: localStorage.getItem('APP_STATEnodeSortableKeys'), cols: localStorage.getItem('APP_STATEcolsPerRow') };
    }, nodeIds);
    const baseline = await control('snapshot');
    assert.ok(baseline.tables > 5);
    const upgraded = await control('upgrade');
    assert.ok(upgraded.unchanged, 'Upgrade changed user-data tables: ' + upgraded.changed_tables.join(', '));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.getByRole('heading', { name: '代理管理', exact: true }).waitFor({ timeout: 45000 });
    const after = await gql('query {nodes{edges{id name tag link}} subscriptions{id tag link nodes{edges{id name}}} groups{id name policy nodes{id} subscriptions{subscription{id} nameFilterRegex}} configs{id name selected global{logLevel tproxyPort lanInterface wanInterface}} dnss{id name selected dns{string}} routings{id name selected routing{string}}}');
    assert.deepEqual(after, before);
    const preferences = await frame.locator('body').evaluate(() => ({ order: localStorage.getItem('APP_STATEnodeSortableKeys'), cols: localStorage.getItem('APP_STATEcolsPerRow') }));
    assert.deepEqual(preferences, oldPreferences);
    console.log('PASS: native previous-release database upgrade retains all user-data table hashes, API resources, bindings, regex and UI preferences');
    const checkConfig = (await gql('query {configs{id selected global{tcpCheckUrl tcpCheckHttpMethod}}}')).configs.find(config => config.selected);
    const proxyFixture = await control('proxy_state');
    await gql('mutation CheckTarget($id:ID!,$global:globalInput!){updateConfig(id:$id,global:$global){id}}', { id: checkConfig.id, global: { tcpCheckUrl: ['http://127.0.0.1:18081/probe', '127.0.0.1'], tcpCheckHttpMethod: 'GET' } });
    const probeSeeds = (await gql('mutation ProbeSeeds($args:[ImportArgument!]!){importNodes(rollbackError:true,args:$args){node{id}}}', { args: Array.from({ length: 8 }, (_, i) => ({ tag: 'Probe fixture ' + i, link: 'socks5://' + proxyFixture.address + '#Probe-' + i })) })).importNodes.map(item => item.node.id);
    const probeStart = Date.now();
    const actualProbes = (await gql('mutation TestNodeLatencies($ids:[ID!]){testNodeLatencies(ids:$ids){id latencyMs alive testedAt}}', { ids: probeSeeds })).testNodeLatencies;
    assert.equal(actualProbes.length, 8);
    assert.ok(actualProbes.every(result => result.alive && Number.isFinite(result.latencyMs)));
    assert.ok(Date.now() - probeStart < 25000, 'Real gateway probes must finish before its 30-second deadline');
    const pollsBefore = (await control('proxy_state')).requests;
    const readStart = Date.now();
    await gql('query {nodeLatencies{id alive latencyMs}}');
    assert.ok(Date.now() - readStart < 3000);
    assert.equal((await control('proxy_state')).requests, pollsBefore, 'Reading latency must not issue new proxy probes');
    await gql('mutation RemoveProbeSeeds($ids:[ID!]!){removeNodes(ids:$ids)}', { ids: probeSeeds });
    await gql('mutation RestoreCheckTarget($id:ID!,$global:globalInput!){updateConfig(id:$id,global:$global){id}}', { id: checkConfig.id, global: checkConfig.global });
    console.log('PASS: actual LuCI CGI -> GraphQL -> eight concurrent SOCKS/HTTP latency probes; cache polling issues no network probes');


    const sections = frame.locator('#panel-common [data-testid=section]');
    await sections.nth(2).getByRole('heading', { name: '订阅', exact: true }).waitFor();
    const nodes = sections.nth(1);
    const subscriptions = sections.nth(2);
    assert.equal(await frame.locator('#panel-advanced-content').isVisible(), false);
    await frame.getByRole('button', { name: '高级设置', exact: true }).click();
    await frame.locator('#panel-advanced-content').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('#panel-advanced-content [data-testid=section]').count(), 3);
    await frame.locator('button[aria-controls="panel-advanced-content"]').click();
    assert.equal(await nodes.locator('[data-rfd-draggable-id]').count(), 7, 'Manual panel excludes subscription nodes');
    assert.equal(await nodes.getByRole('combobox', { name: '节点来源' }).count(), 0);
    const search = nodes.getByRole('searchbox', { name: '搜索节点' });
    await search.fill('missing-node');
    await nodes.getByRole('heading', { name: '没有匹配的节点' }).waitFor();
    await nodes.getByRole('button', { name: '清除筛选' }).first().click();
    await search.fill('Legacy manual 2');
    await nodes.getByRole('button', { name: '加入群组', exact: true }).click();
    const dialog = frame.getByRole('dialog');
    await dialog.getByText('LegacyGroup', { exact: true }).locator('..').getByRole('button', { name: '加入', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const bound = await gql('query {groups{id nodes{id}}}');
    assert.ok(bound.groups.find(item => item.id === groupId).nodes.some(item => item.id === nodeIds[1]));
    await nodes.getByRole('button', { name: '加入群组', exact: true }).click();
    assert.ok(await dialog.getByText('LegacyGroup', { exact: true }).locator('..').getByRole('button', { name: '已加入' }).isDisabled());
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    console.log('PASS: separate manual-node panel, search/no results and real group binding with duplicate prevention');

    await search.fill('Legacy manual');
    const handle = nodes.locator(`[data-rfd-drag-handle-draggable-id="node-${nodeIds[1]}"]`);
    await page.waitForTimeout(300);
    await handle.focus();
    assert.ok(await handle.evaluate(element => document.activeElement === element));
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    const order = await frame.locator('body').evaluate(() => JSON.parse(localStorage.getItem('APP_STATEnodeSortableKeys')));
    assert.equal(order[0], nodeIds[0]);
    assert.equal(order[1], nodeIds[1]);
    console.log('PASS: native keyboard drag after filtering preserves hidden node order');

    await search.fill('Legacy manual 3');
    const mouseHandle = nodes.locator(`[data-rfd-drag-handle-draggable-id="node-${nodeIds[2]}"]`);
    const groupCard = sections.nth(0).locator('[data-group-card-id]').filter({ hasText: 'LegacyGroup' });
    await groupCard.scrollIntoViewIfNeeded();
    const from = await mouseHandle.boundingBox(), to = await groupCard.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + Math.min(60, to.height / 2), { steps: 20 });
    await page.waitForTimeout(250);
    const expandedBox = await groupCard.boundingBox();
    const groupViewport = await sections.nth(0).locator('.panel-side-scroll').boundingBox();
    await page.mouse.move(expandedBox.x + expandedBox.width / 2,
      (Math.max(expandedBox.y, groupViewport.y) + Math.min(expandedBox.y + expandedBox.height, groupViewport.y + groupViewport.height)) / 2,
      { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.ok((await gql('query {groups{id nodes{id}}}')).groups.find(item => item.id === groupId).nodes.some(item => item.id === nodeIds[2]));
    console.log('PASS: pointer drag from virtual list into a collapsed group expands and binds the node through the real API');

    await control('subscription_fail', { enabled: true });
    const originalSubNodes = (await gql('query {subscriptions{id nodes{edges{id name}}}}')).subscriptions;
    await subscriptions.getByRole('button', { name: '更新订阅', exact: true }).click();
    await subscriptions.getByRole('alert').filter({ hasText: '更新失败' }).waitFor({ timeout: 20000 });
    assert.deepEqual((await gql('query {subscriptions{id nodes{edges{id name}}}}')).subscriptions, originalSubNodes);
    await control('subscription_fail', { enabled: false });
    await subscriptions.getByRole('button', { name: '重试', exact: true }).click();
    await subscriptions.getByRole('button', { name: '更新订阅', exact: true }).waitFor();
    console.log('PASS: real failed subscription fetch retains nodes; retry succeeds');

    const proxyBefore = (await control('proxy_state')).requests;
    await subscriptions.getByRole('button', { name: /(?:导入|添加)\s*订阅/ }).click();
    await dialog.getByRole('textbox', { name: /链接/ }).fill('http://127.0.0.1:18081/requires-socks?private=fixture-only');
    await dialog.getByRole('textbox', { name: /标签/ }).fill('SOCKS subscription');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const proxySubs = (await gql('query {subscriptions{id tag nodes{edges{id name}}}}')).subscriptions;
    const proxied = proxySubs.find(item => item.tag === 'SOCKS subscription');
    assert.equal(proxied?.nodes.edges.length, 2);
    assert.ok((await control('proxy_state')).requests > proxyBefore);
    await gql('mutation ProxyUpdate($id:ID!){updateSubscription(id:$id){id}}', { id: proxied.id });
    await control('proxy_state', { down: true });
    const failedUpdate = await context.request.post(base + '/cgi-bin/daed-router/graphql', { headers: { Origin: base }, data: { query: 'mutation ProxyUpdate($id:ID!){updateSubscription(id:$id){id}}', variables: { id: proxied.id } } });
    const failureBody = await failedUpdate.json();
    assert.ok(failureBody.errors?.length);
    assert.ok(!JSON.stringify(failureBody.errors).includes('private=fixture-only'));
    const retained = (await gql('query {subscriptions{id nodes{edges{id name}}}}')).subscriptions.find(item => item.id === proxied.id);
    assert.deepEqual(retained.nodes.edges.map(item => item.name), proxied.nodes.edges.map(item => item.name));
    await control('proxy_state', { down: false });
    await gql('mutation ProxyRetry($id:ID!){updateSubscription(id:$id){id}}', { id: proxied.id });
    console.log('PASS: native LuCI subscription dialog imports through discovered SOCKS after AUTH_FAIL; manual update, failed-exit preservation and retry use the real backend');

    await nodes.getByRole('button', { name: '导入节点', exact: true }).click();
    await dialog.getByRole('textbox', { name: /链接/ }).fill('not-a-node-link');
    await dialog.getByRole('textbox', { name: /标签/ }).fill('keep-this-input');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: /标签/ }).inputValue(), 'keep-this-input');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    console.log('PASS: failed import keeps the form open and retains entered values');

    await sections.nth(0).getByRole('button', { name: '新建群组', exact: true }).click();
    await dialog.getByRole('textbox', { name: /名字/ }).fill('invalid group name');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: /名字/ }).inputValue(), 'invalid group name');
    await dialog.getByRole('textbox', { name: /名字/ }).fill('NewGroup');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok((await gql('query {groups{name}}')).groups.some(group => group.name === 'NewGroup'));
    await search.fill('Legacy manual 1');
    await nodes.getByRole('button', { name: /^更多操作 / }).click();
    await frame.getByRole('menuitem', { name: '编辑', exact: true }).click();
    assert.equal(await dialog.getByRole('textbox', { name: /标签/ }).inputValue(), 'Legacy manual 1');
    await dialog.getByRole('textbox', { name: /标签/ }).fill('Edited manual');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok((await gql('query {nodes{edges{tag link}}}')).nodes.edges.some(node => node.tag === 'Edited manual' && node.link.includes('192.0.2.20')));
    console.log('PASS: failed group creation retains input; valid group and node edits persist through real API');

    await search.fill('Edited manual');
    await nodes.locator('[data-node-details]').click();
    const sheet = frame.getByRole('dialog');
    await sheet.getByRole('button', { name: '编辑', exact: true }).click();
    const nestedEditor = frame.getByRole('dialog').filter({ has: frame.getByRole('textbox', { name: /标签/ }) });
    await nestedEditor.getByRole('textbox', { name: /标签/ }).fill('Edited in drawer');
    await nestedEditor.getByRole('button', { name: '提交', exact: true }).click();
    await nestedEditor.waitFor({ state: 'hidden' });
    await sheet.getByText('Edited in drawer', { exact: true }).first().waitFor();
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    console.log('PASS: editing inside node details updates the open drawer from current data without losing search state');

    await search.fill('');
    const large = await gql('mutation {importSubscription(rollbackError:true,arg:{tag:"Workspace 1000",link:"http://127.0.0.1:18081/sub-large"}){sub{id} nodeImportResult{node{id}}}}');
    assert.equal(large.importSubscription.nodeImportResult.length, 1000);
    const largeId = large.importSubscription.sub.id;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await nodes.locator('[data-node-scroll]').waitFor();
    assert.equal(await nodes.locator('[data-node-id]').count(), 7, '1000 subscription nodes must not enter the manual list');
    const largeCard = subscriptions.locator('[data-rfd-draggable-id]').filter({ hasText: 'Workspace 1000' });
    const beforeLargeHeight = (await frame.locator('#panel-common').boundingBox()).height;
    await largeCard.getByRole('button', { name: /查看节点/ }).click();
    const viewer = frame.locator('[data-subscription-browser]');
    const grid = viewer.getByRole('list', { name: '订阅节点', exact: true });
    assert.equal(await grid.locator('[data-subscription-node]').count(), 1000);
    assert.equal(await viewer.getByRole('navigation', { name: '节点分页' }).count(), 0);
    assert.equal(await viewer.getByRole('combobox', { name: '每页数量' }).count(), 0);
    await page.waitForTimeout(300);
    const toolbarTop = (await viewer.getByRole('searchbox').boundingBox()).y;
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await grid.getByText('Workspace-0999-Long-node-name-for-layout-testing', { exact: true }).scrollIntoViewIfNeeded();
    assert.equal((await viewer.getByRole('searchbox').boundingBox()).y, toolbarTop);
    assert.ok(await grid.evaluate(element => element.scrollTop > 10000 && element.scrollWidth <= element.clientWidth + 1));
    const subscriptionSearch = viewer.getByRole('searchbox', { name: '搜索节点' });
    await subscriptionSearch.fill('Workspace-0999');
    assert.equal(await grid.locator('[data-subscription-node]').count(), 1);
    await grid.getByRole('button', { name: /^节点详情 / }).click();
    const detail = frame.locator('[data-slot=sheet-content]');
    await detail.getByText('节点详情', { exact: true }).waitFor();
    assert.equal(await detail.getByRole('button', { name: '编辑', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await detail.waitFor({ state: 'hidden' });
    assert.equal(await subscriptionSearch.inputValue(), 'Workspace-0999');
    await grid.getByRole('button', { name: /二维码/ }).click();
    await frame.getByRole('dialog').locator('canvas').waitFor();
    await page.keyboard.press('Escape');
    await frame.getByRole('dialog').locator('canvas').waitFor({ state: 'hidden' });
    assert.equal(await subscriptionSearch.inputValue(), 'Workspace-0999');
    await grid.getByRole('button', { name: '加入群组', exact: true }).click();
    const picker = frame.getByRole('dialog').filter({ has: frame.getByText('加入群组', { exact: true }) }).last();
    await picker.getByText('LegacyGroup', { exact: true }).locator('..').getByRole('button', { name: '加入', exact: true }).click();
    assert.ok((await gql('query {groups{id nodes{name}}}')).groups.find(item => item.id === groupId).nodes.some(item => item.name.includes('Workspace-0999')));
    // Deterministic transport failures and batch UI are fault-injected; actual
    // HTTP-over-SOCKS probe/cancellation is tested in Go against a local server.
    let probeRequests = [], failProbe = false, probeLatency = 18;
    await page.route('**/cgi-bin/daed-router/graphql', async route => {
      const payload = route.request().postDataJSON();
      if (!/mutation TestNodeLatencies/.test(payload.query)) return route.continue();
      const ids = payload.variables.ids; probeRequests.push(ids);
      await new Promise(resolve => setTimeout(resolve, 80));
      if (failProbe) return route.fulfill({ status: 502, contentType: 'text/plain', body: 'Injected gateway failure' });
      return route.fulfill({ json: { data: { testNodeLatencies: ids.map(id => ({ id, alive: probeLatency !== null, latencyMs: probeLatency, testedAt: new Date().toISOString(), message: null })) } } });
    });
    await grid.getByRole('button', { name: /^测试节点延迟 / }).click();
    await grid.getByText('18 ms', { exact: true }).waitFor();
    assert.equal(probeRequests[0].length, 1);
    const colors = {};
    for (const [value, tone] of [[199,'good'],[200,'warning'],[499,'warning'],[500,'bad'],[null,'bad']]) {
      probeLatency = value;
      await grid.getByRole('button', { name: /^测试节点延迟 / }).click();
      await grid.locator(`[data-latency-tone="${tone}"]`).waitFor();
      await grid.locator('button:not(:disabled)').filter({ hasText: '测速' }).waitFor();
      assert.equal(await grid.locator('[data-latency-tone]').getAttribute('data-latency-tone'), tone);
      colors[tone] = await grid.locator('[data-latency-tone]').evaluate(element => getComputedStyle(element).color);
    }
    assert.equal(new Set(Object.values(colors)).size, 3, 'Green, yellow and red must be visually distinct');
    probeLatency = 18;
    await grid.getByRole('button', { name: /^测试节点延迟 / }).click();
    await grid.getByText('18 ms', { exact: true }).waitFor();
    probeRequests = [probeRequests.at(-1)];

    await subscriptionSearch.fill('Workspace-00');
    await viewer.getByRole('button', { name: '测试当前结果', exact: true }).click();
    await viewer.getByText(/测速进度/).waitFor();
    await viewer.getByRole('button', { name: '本批完成后停止', exact: true }).click();
    await viewer.locator('button:not(:disabled)').filter({ hasText: '测试当前结果' }).waitFor();
    assert.ok(probeRequests.length <= 3, 'Stop must cancel future batches');
    probeRequests = [];
    await viewer.getByRole('button', { name: '测试当前结果', exact: true }).click();
    await viewer.locator('button:not(:disabled)').filter({ hasText: '测试当前结果' }).waitFor();
    assert.equal(probeRequests.flat().length, 100);
    assert.ok(probeRequests.every(ids => ids.length <= 8));
    failProbe = true;
    await subscriptionSearch.fill('Workspace-0999');
    await grid.getByRole('button', { name: /^测试节点延迟 / }).click();
    await viewer.getByRole('alert').waitFor();
    assert.ok(!(await viewer.getByRole('alert').innerText()).includes('GraphQL'));
    await grid.getByText('18 ms', { exact: true }).waitFor();
    failProbe = false;
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    await search.fill('Edited in drawer');
    await nodes.getByRole('button', { name: /^测试节点延迟 / }).click();
    await nodes.getByRole('button', { name: /^测试节点延迟 / }).getByText('18 ms', { exact: true }).waitFor();
    assert.deepEqual(probeRequests.at(-1), [nodeIds[0]], 'Manual single-node test must submit only that node');
    await page.unroute('**/cgi-bin/daed-router/graphql');
    assert.ok(Math.abs((await frame.locator('#panel-common').boundingBox()).height - beforeLargeHeight) < 3);
    console.log('PASS: manual/subscription separation, 1000-node continuous grid/search, latency color boundaries, nested details/QR/group binding, per-node test, bounded batch/progress/stop and 502 input/result preservation');
    await largeCard.getByRole('button', { name: /查看节点/ }).click();
    const lastTile = grid.locator('[data-subscription-node]').last();
    await lastTile.scrollIntoViewIfNeeded();
    const savedScroll = await grid.evaluate(element => element.scrollTop);
    await lastTile.getByRole('button', { name: /^节点详情 / }).click();
    await detail.waitFor();
    await page.keyboard.press('Escape');
    await detail.waitFor({ state: 'hidden' });
    assert.ok(Math.abs(await grid.evaluate(element => element.scrollTop) - savedScroll) < 3, 'Closing details should retain continuous-list position');
    await viewer.evaluate(element => { element.ownerDocument.documentElement.style.fontSize = '20px'; });
    assert.ok(await lastTile.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Large text must wrap within the card');
    assert.ok(await lastTile.evaluate(element => { const tile = element.getBoundingClientRect(); return [...element.querySelectorAll('button')].every(button => { const r = button.getBoundingClientRect(); return r.bottom <= tile.bottom + 1 && r.right <= tile.right + 1; }); }), 'Card actions must remain fully inside the card at larger text sizes');
    await viewer.evaluate(element => { element.ownerDocument.documentElement.style.fontSize = ''; });
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    await frame.getByRole('button', { name: '查看流量趋势', exact: true }).click();
    await frame.locator('#panel-traffic-trends svg.recharts-surface').first().waitFor();
    for (const name of ['10 分钟', '30 分钟', '1 小时']) await frame.getByRole('button', { name, exact: true }).click();
    await frame.getByRole('button', { name: '收起流量趋势', exact: true }).click();
    await frame.getByRole('button', { name: '常用功能', exact: true }).click();
    for (const width of [320, 390, 768, 1024, 1600]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(150);
      assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow at ' + width);
      assert.deepEqual(await sections.locator(':scope > div:first-child h2').allTextContents(), ['群组', '节点', '订阅']);
      const tabs = frame.getByRole('tablist', { name: '常用功能' });
      if (await tabs.isVisible()) {
        await tabs.getByRole('tab', { name: /群组/ }).click();
        assert.equal(await nodes.isVisible(), false);
        await tabs.getByRole('tab', { name: /节点/ }).click();
        await search.fill('Edited in drawer');
        await tabs.getByRole('tab', { name: /订阅/ }).click();
      }
      await largeCard.getByRole('button', { name: /查看节点/ }).click();
      assert.ok(await viewer.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      assert.equal(await grid.locator('[data-subscription-node]').count(), 1000);
      await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await grid.getByText('Workspace-0999-Long-node-name-for-layout-testing', { exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await grid.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: path.join(output, 'subscription-' + width + '.png'), fullPage: true });
      await page.keyboard.press('Escape');
      await viewer.waitFor({ state: 'hidden' });
      if (await tabs.isVisible()) {
        await tabs.getByRole('tab', { name: /节点/ }).click();
        assert.equal(await search.inputValue(), 'Edited in drawer');
      }
      await page.screenshot({ path: path.join(output, 'native-' + width + '.png'), fullPage: true });
    }
    await gql('mutation ExtraManualNodes($args:[ImportArgument!]!){importNodes(rollbackError:true,args:$args){node{id}}}', { args: Array.from({ length: 13 }, (_, i) => ({ tag: 'Manual page ' + i, link: `vless://55555555-5555-4555-8555-${String(i).padStart(12, '0')}@192.0.2.90:443?encryption=none&security=tls&type=tcp#Manual-page-${i}` })) });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const manualScroll = nodes.locator('[data-node-scroll]');
    await manualScroll.waitFor();
    assert.equal(await nodes.getByRole('navigation', { name: '节点分页' }).count(), 0);
    await manualScroll.evaluate(element => { element.scrollTop = 12 * 76; });
    await page.waitForTimeout(150);
    const visibleManualId = await manualScroll.evaluate(element => {
      const viewport = element.getBoundingClientRect();
      return [...element.querySelectorAll('[data-node-id]')].find(row => { const r = row.getBoundingClientRect(); return r.top >= viewport.top && r.bottom <= viewport.bottom; }).dataset.nodeId;
    });
    const pageHandle = nodes.locator(`[data-rfd-drag-handle-draggable-id="node-${visibleManualId}"]`);
    const movedPageId = (await pageHandle.getAttribute('data-rfd-drag-handle-draggable-id')).replace(/^node-/, '');
    const pageOrderBefore = await frame.locator('body').evaluate(() => JSON.parse(localStorage.getItem('APP_STATEnodeSortableKeys')));
    await pageHandle.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    const pageOrderAfter = await frame.locator('body').evaluate(() => JSON.parse(localStorage.getItem('APP_STATEnodeSortableKeys')));
    assert.equal(pageOrderAfter.length, 20);
    assert.equal(pageOrderAfter[13], movedPageId);
    assert.deepEqual(pageOrderAfter.slice(0, 7), pageOrderBefore.slice(0, 7));
    assert.equal(new Set(pageOrderAfter).size, 20);
    console.log('PASS: manual continuous list keyboard sorting uses full-library indices and retains hidden ordering');
    // Fault injection tests control states only. Run is NEVER forwarded to the daemon.
    let runRequests = [], fakeRunning = false, fakeModified = true, failRun = true;
    await page.route('**/cgi-bin/daed-router/graphql', async route => {
      const payload = route.request().postDataJSON();
      if (/mutation Run\b/.test(payload.query)) {
        runRequests.push(payload.variables.dry);
        await new Promise(resolve => setTimeout(resolve, 200));
        if (failRun) return route.fulfill({ json: { errors: [{ message: 'Injected run failure' }] } });
        fakeRunning = !payload.variables.dry;
        fakeModified = false;
        return route.fulfill({ json: { data: { run: 0 } } });
      }
      if (/query General\b/.test(payload.query)) {
        const response = await route.fetch();
        const body = await response.json();
        body.data.general.dae.running = fakeRunning;
        body.data.general.dae.modified = fakeModified;
        return route.fulfill({ response, json: body });
      }
      return route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.getByRole('button', { name: '启动代理', exact: true }).click();
    await frame.getByRole('button', { name: '启动中…', exact: true }).waitFor();
    assert.ok(await frame.getByRole('button', { name: '应用配置', exact: true }).isDisabled());
    await frame.locator('header [role=alert]').waitFor();
    failRun = false;
    await frame.locator('header').getByRole('button', { name: '重试', exact: true }).click();
    await frame.getByRole('button', { name: '停止代理', exact: true }).waitFor();
    await frame.getByRole('button', { name: '停止代理', exact: true }).click();
    await frame.getByRole('button', { name: '启动代理', exact: true }).waitFor();
    fakeModified = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.getByRole('button', { name: '应用配置', exact: true }).click();
    await frame.getByRole('button', { name: '应用中…', exact: true }).waitFor();
    await frame.getByRole('button', { name: '停止代理', exact: true }).waitFor();
    assert.equal(await frame.getByRole('button', { name: '应用配置', exact: true }).count(), 0);
    assert.deepEqual(runRequests, [false, false, true, false]);
    await page.unroute('**/cgi-bin/daed-router/graphql');
    console.log('PASS: fault-injected run failure/retry, pending guard and correct start/stop dry flags; no eBPF invoked');
    assert.ok(!(await frame.locator('body').innerText()).includes('欢迎来到 daed'));
    assert.deepEqual(errors, []);
    console.log('PASS: retained traffic ranges/charts, responsive views and no page exceptions');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, dataTables: baseline.tables, widths: [320, 390, 768, 1024, 1600] }, null, 2));
    await context.close();
    const secureContext = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'zh-CN' });
    const securePage = await secureContext.newPage();
    const secureFrame = await login(securePage, base.replace(':18080', ':18443').replace('http:', 'https:'));
    await secureFrame.getByRole('heading', { name: '代理管理', exact: true }).waitFor({ timeout: 45000 });
    const cookie = (await secureContext.cookies()).find(item => item.name === 'daed_luci_session');
    assert.ok(cookie && cookie.secure && cookie.httpOnly);
    await secureContext.close();
    console.log('PASS: HTTPS native LuCI single-session panel with Secure/HttpOnly cookie');
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'zh-CN' });
    const touchPage = await touchContext.newPage();
    const touchFrame = await login(touchPage);
    await touchFrame.locator('[data-node-scroll]').waitFor();
    const touchTabs = touchFrame.getByRole('tablist', { name: '常用功能' });
    await touchTabs.getByRole('tab', { name: /订阅/ }).tap();
    const touchSubscription = touchFrame.locator('#workspace-subscriptions [data-rfd-draggable-id]').filter({ hasText: 'Workspace 1000' });
    await touchSubscription.getByRole('button', { name: /查看节点/ }).tap();
    const touchViewer = touchFrame.locator('[data-subscription-browser]');
    assert.equal(await touchViewer.locator('[data-subscription-node]').count(), 1000);
    await touchViewer.getByRole('searchbox', { name: '搜索节点' }).fill('Workspace-0999');
    await touchViewer.getByRole('button', { name: /^节点详情 / }).tap();
    assert.ok(await touchFrame.locator('[data-slot=sheet-content]').getByText('节点详情', { exact: true }).isVisible());
    await touchPage.waitForTimeout(550);
    const touchBounds = await touchPage.locator('iframe').boundingBox();
    const drawerBounds = await touchFrame.locator('[data-slot=sheet-content]').boundingBox();
    assert.ok(Math.abs(drawerBounds.width - touchBounds.width) < 2, 'Mobile drawer must occupy the full panel width');
    assert.ok(await touchFrame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await touchPage.screenshot({ path: path.join(output, 'native-touch-dark.png'), fullPage: true });
    await touchContext.close();
    console.log('PASS: touch-enabled mobile dark theme, subscription-to-node navigation, long names and full-width detail drawer');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Unavailable'));
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
