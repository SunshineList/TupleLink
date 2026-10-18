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
    console.log('PASS: native 0.2.1 database upgrade retains all user-data table hashes, API resources, bindings, regex and UI preferences');

    const sections = frame.locator('#panel-common [data-testid=section]');
    await sections.nth(2).getByRole('heading', { name: '订阅', exact: true }).waitFor();
    const nodes = sections.nth(1);
    const subscriptions = sections.nth(2);
    assert.equal(await frame.locator('#panel-advanced-content').isVisible(), false);
    await frame.getByRole('button', { name: '高级设置', exact: true }).click();
    await frame.locator('#panel-advanced-content').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('#panel-advanced-content [data-testid=section]').count(), 3);
    await frame.locator('button[aria-controls="panel-advanced-content"]').click();
    const source = nodes.getByRole('combobox', { name: '节点来源' });
    await source.selectOption('manual');
    await nodes.getByRole('button', { name: /显示更多/ }).click();
    assert.equal(await nodes.locator('[data-rfd-draggable-id]').count(), 7);
    await source.selectOption(subscriptionId);
    assert.equal(await nodes.locator('[data-rfd-draggable-id]').count(), 2);
    assert.equal(await nodes.getByRole('button', { name: /^编辑 / }).count(), 0);
    await source.selectOption('manual');
    const search = nodes.getByRole('searchbox', { name: '搜索节点' });
    await search.fill('missing-node');
    await nodes.getByRole('heading', { name: '没有匹配的节点' }).waitFor();
    await nodes.getByRole('button', { name: '清除筛选' }).click();
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
    console.log('PASS: source filtering, read-only subscription nodes, search/no results and real group binding with duplicate prevention');

    await search.fill('Legacy manual');
    await source.selectOption('manual');
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

    await control('subscription_fail', { enabled: true });
    const originalSubNodes = (await gql('query {subscriptions{id nodes{edges{id name}}}}')).subscriptions;
    await subscriptions.getByRole('button', { name: '更新订阅', exact: true }).click();
    await subscriptions.getByRole('alert').filter({ hasText: '更新失败' }).waitFor({ timeout: 20000 });
    assert.deepEqual((await gql('query {subscriptions{id nodes{edges{id name}}}}')).subscriptions, originalSubNodes);
    await control('subscription_fail', { enabled: false });
    await subscriptions.getByRole('button', { name: '重试', exact: true }).click();
    await subscriptions.getByRole('button', { name: '更新订阅', exact: true }).waitFor();
    console.log('PASS: real failed subscription fetch retains nodes; retry succeeds');

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
    await nodes.getByRole('button', { name: /^编辑 / }).click();
    assert.equal(await dialog.getByRole('textbox', { name: /标签/ }).inputValue(), 'Legacy manual 1');
    await dialog.getByRole('textbox', { name: /标签/ }).fill('Edited manual');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok((await gql('query {nodes{edges{tag link}}}')).nodes.edges.some(node => node.tag === 'Edited manual' && node.link.includes('192.0.2.20')));
    console.log('PASS: failed group creation retains input; valid group and node edits persist through real API');

    await search.fill('');
    await source.selectOption('all');
    await frame.getByRole('button', { name: '查看流量趋势', exact: true }).click();
    await frame.locator('#panel-traffic-trends svg.recharts-surface').first().waitFor();
    for (const name of ['10 分钟', '30 分钟', '1 小时']) await frame.getByRole('button', { name, exact: true }).click();
    await frame.getByRole('button', { name: '收起流量趋势', exact: true }).click();
    await frame.getByRole('button', { name: '常用功能', exact: true }).click();
    for (const width of [390, 768, 1600]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(150);
      assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow at ' + width);
      assert.deepEqual(await sections.locator(':scope > div:first-child h2').allTextContents(), ['群组', '节点', '订阅']);
      await page.screenshot({ path: path.join(output, 'native-' + width + '.png'), fullPage: true });
    }
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
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, dataTables: baseline.tables, widths: [390, 768, 1600] }, null, 2));
    await context.close();
    const secureContext = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'zh-CN' });
    const securePage = await secureContext.newPage();
    const secureFrame = await login(securePage, base.replace(':18080', ':18443').replace('http:', 'https:'));
    await secureFrame.getByRole('heading', { name: '代理管理', exact: true }).waitFor({ timeout: 45000 });
    const cookie = (await secureContext.cookies()).find(item => item.name === 'daed_luci_session');
    assert.ok(cookie && cookie.secure && cookie.httpOnly);
    await secureContext.close();
    console.log('PASS: HTTPS native LuCI single-session panel with Secure/HttpOnly cookie');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Unavailable'));
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
