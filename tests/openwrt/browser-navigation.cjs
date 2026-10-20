/* Real native_panel.py comparison. No production router, no eBPF/network takeover. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { chromium } = require('playwright')
const base = process.env.DAED_PANEL_URL || 'http://localhost:18080'
const controlDirectory = process.env.DAED_PANEL_CONTROL
const output = process.env.DAED_NAV_OUTPUT || '.build/navigation-browser'
if (!controlDirectory) throw new Error('Set DAED_PANEL_CONTROL to native_panel.py --control')
fs.mkdirSync(output, { recursive: true })
async function control(action, extra = {}) {
  const id = Date.now()
  fs.writeFileSync(path.join(controlDirectory, 'command.json'), JSON.stringify({ id, action, ...extra }))
  for (let i = 0; i < 300; i++) {
    try {
      const answer = JSON.parse(fs.readFileSync(path.join(controlDirectory, 'result.json'), 'utf8'))
      if (answer.id === id) return answer
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Fixture control timed out: ${action}`)
}
async function login(page) {
  await page.goto(`${base}/cgi-bin/luci/admin/services/daed/dashboard`)
  if (await page.locator('input[name=luci_username]').count()) {
    await page.locator('input[name=luci_username]').fill('root')
    await page.locator('input[name=luci_password]').fill('fixture-password')
    await page.getByRole('button', { name: /Log in|登录/ }).click()
  }
  await page.frameLocator('iframe').locator('[data-workspace="dashboard"]').waitFor({ timeout: 45000 })
}
async function switchMenu(page, area) {
  const started = performance.now()
  await page.locator(`a[href$="/daed/${area}"]:visible`).first().click()
  await page.frameLocator('iframe').locator(`[data-workspace="${area}"]`).waitFor()
  await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return { area, ms: Math.round(performance.now() - started) }
}
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.DAED_BROWSER_EXECUTABLE ? { executablePath: process.env.DAED_BROWSER_EXECUTABLE } : {}),
  })
  let page
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
    page = await context.newPage()
    const errors = []
    const requests = []
    const responses = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) =>
      requests.push({ type: request.resourceType(), url: request.url(), body: request.postData() || '' }),
    )
    page.on('response', (response) =>
      responses.push({ url: response.url(), status: response.status(), cache: response.headers()['cache-control'] }),
    )
    await login(page)
    const gql = async (query, variables = {}) => {
      const response = await context.request.post(`${base}/cgi-bin/daed-router/graphql`, {
        headers: { Origin: base },
        data: { query, variables },
      })
      assert.equal(response.status(), 200)
      const value = await response.json()
      assert.ok(!value.errors, JSON.stringify(value.errors))
      return value.data
    }
    for (const label of ['a', 'b'])
      await gql('mutation($arg:ImportArgument!){importSubscription(rollbackError:true,arg:$arg){sub{id}}}', {
        arg: { tag: `Navigation-${label}`, link: `http://127.0.0.1:18081/sub-recovery-${label}` },
      })
    const baseline = []
    for (const area of ['resources', 'advanced', 'dashboard', 'resources', 'dashboard'])
      baseline.push(await switchMenu(page, area))
    fs.writeFileSync(path.join(output, 'baseline.json'), JSON.stringify(baseline, null, 2))
    const resources =
      'query{nodes{edges{id name tag link}} subscriptions{id tag link nodes{edges{id name}}} groups{id name policy nodes{id}} configs{id name selected} dnss{id name selected dns{string}} routings{id name selected routing{string}}}'
    const oldData = await gql(resources)
    await control('snapshot')
    const upgraded = await control('upgrade')
    assert.equal(upgraded.unchanged, true)
    // The sidebar commonly opens the plugin root, not /dashboard.
    await page.goto(`${base}/cgi-bin/luci/admin/services/daed`)
    await page.frameLocator('iframe').locator('[data-workspace="dashboard"]').waitFor({ timeout: 45000 })
    assert.deepEqual(await gql(resources), oldData)
    const f = page.frameLocator('iframe')
    assert.ok(
      !requests.some((item) => /DaeEditorImpl|GraphQLPage|editor\.api/.test(item.url)),
      'Heavy tools loaded before being opened',
    )
    const marker = `retained-${Date.now()}`
    await f.locator('body').evaluate((_el, value) => {
      window.navigationMarker = value
    }, marker)
    const start = requests.length
    const after = []
    for (const area of ['resources', 'advanced', 'logs', 'dashboard', 'resources']) {
      after.push(await switchMenu(page, area))
      assert.equal(await f.locator('body').evaluate(() => window.navigationMarker), marker, 'iframe was reloaded')
      assert.equal(new URL(page.url()).pathname.split('/').pop(), area)
      assert.ok(await page.locator(`a[href$="/daed/${area}"][aria-current="page"]`).count())
    }
    const during = requests.slice(start)
    fs.writeFileSync(path.join(output, 'after.json'), JSON.stringify(after, null, 2))
    assert.equal(during.filter((item) => item.type === 'document').length, 0, 'Soft navigation fetched a document')
    assert.equal(during.filter((item) => item.url.endsWith('/session')).length, 0, 'Soft navigation repeated bootstrap')
    assert.equal(
      during.filter((item) => /query (?:Defaults|Mode|Interfaces)\b/.test(item.body)).length,
      0,
      'Soft navigation repeated initialization',
    )
    await page.goBack()
    await f.locator('[data-workspace="dashboard"]').waitFor()
    await page.goForward()
    await f.locator('[data-workspace="resources"]').waitFor()
    assert.equal(await f.locator('body').evaluate(() => window.navigationMarker), marker)
    await page.setViewportSize({ width: 390, height: 844 })
    await switchMenu(page, 'advanced')
    await switchMenu(page, 'logs')
    await f.getByRole('heading', { name: 'NaiLink 运行日志' }).waitFor()
    await page.screenshot({ path: path.join(output, 'mobile-logs.png'), fullPage: true })
    await page.setViewportSize({ width: 1600, height: 1000 })
    await switchMenu(page, 'advanced')
    const dns = f
      .locator('[data-testid="section"]')
      .filter({ has: f.getByRole('heading', { name: 'DNS', exact: true }) })
    // Settings button carries the Settings2 icon; do not depend on tooltip timing.
    await dns
      .locator('button')
      .filter({ has: f.locator('svg.lucide-settings-2') })
      .click()
    await f.getByRole('tab', { name: /进阶模式|高级模式|Advanced/ }).click()
    await f.locator('.monaco-editor').first().waitFor({ timeout: 30000 })
    assert.ok(
      requests.some((item) => /DaeEditorImpl/.test(item.url)),
      'Editor did not load on demand',
    )
    await page.screenshot({ path: path.join(output, 'editor-lazy.png'), fullPage: true })
    // Current Chromium uses Monaco's native EditContext div; its hidden
    // textarea is intentionally readonly. Click the editor as a user would.
    await f.locator('.monaco-editor .view-lines').getByText('upstream', { exact: false }).first().waitFor()
    await f.locator('.monaco-editor .view-lines').first().click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('# menu-navigation-edit', { delay: 40 })
    await f
      .locator('.monaco-editor .view-lines')
      .getByText(/menu-navigation-edit/)
      .waitFor()
    await f.getByRole('button', { name: '确定', exact: true }).click()
    await f.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.ok(
      (await gql('query{dnss{id dns{string}}}')).dnss.some((item) => item.dns.string.includes('menu-navigation-edit')),
      'Lazy editor save did not persist',
    )
    const offlineContext = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN' })
    const offline = await offlineContext.newPage()
    await offline.route('**/assets/DaeEditorImpl-*.js', (route) => route.abort())
    await login(offline)
    await switchMenu(offline, 'advanced')
    const of = offline.frameLocator('iframe')
    await of
      .locator('[data-testid="section"]')
      .filter({ has: of.getByRole('heading', { name: 'DNS', exact: true }) })
      .locator('button')
      .filter({ has: of.locator('svg.lucide-settings-2') })
      .click()
    await of.getByRole('tab', { name: /进阶模式|Advanced/ }).click()
    const textMode = of.getByRole('textbox', { name: '配置代码', exact: true })
    await textMode.waitFor()
    await textMode.fill(`${await textMode.inputValue()}\n# plain-text-fallback`)
    await of.getByRole('button', { name: '确定', exact: true }).click()
    await of.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.ok(
      (await gql('query{dnss{dns{string}}}')).dnss.some((item) => item.dns.string.includes('plain-text-fallback')),
      'Offline text fallback did not save',
    )
    await offlineContext.close()
    // A real gateway fetch still denies a revoked session, including assets.
    const session = await page.evaluate(() => globalThis.L.env.sessionid)
    await control('revoke_session', { session })
    await page.locator('a[href$="/daed/resources"]:visible').first().click()
    await f.getByText('路由器登录已失效，请刷新后台页面。', { exact: true }).waitFor()
    const asset = responses.find(
      (item) => /\/assets\/index-[\w-]+\.js$/.test(item.url) && item.cache?.includes('immutable'),
    )
    assert.ok(asset, 'No immutable private asset response observed')
    assert.equal((await context.request.get(asset.url)).status(), 401)
    assert.equal((await context.request.get(`${base}/cgi-bin/daed-router/`)).status(), 401)
    assert.deepEqual(errors, [])
    const result = {
      baseline,
      after,
      softDocumentRequests: 0,
      softBootstrapRequests: 0,
      upgradeDataPreserved: true,
      privateAssetCaching: true,
      lazyEditor: true,
      offlineEditorFallback: true,
      revocation: true,
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
      fs.writeFileSync(path.join(output, 'failure.html'), await page.content().catch(() => ''))
    }
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
