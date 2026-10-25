/* Real LuCI/RPC/procd + private HTTPS future-release fixture; no real upgrade. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { chromium } = require('playwright')
const base = process.env.DAED_PANEL_URL || 'http://localhost:18080'
const directory = process.env.DAED_PANEL_CONTROL
const output = process.env.DAED_MAINTENANCE_OUTPUT || '.build/maintenance-browser'
if (!directory) throw new Error('Set DAED_PANEL_CONTROL to native_panel --maintenance-fixture control')
fs.mkdirSync(output, { recursive: true })
async function control(action, extra = {}) {
  const id = `${Date.now()}-${Math.random()}`
  fs.writeFileSync(path.join(directory, 'command.json'), JSON.stringify({ id, action, ...extra }))
  for (let i = 0; i < 300; i++) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'))
      if (value.id === id) return value
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Fixture action timed out: ${action}`)
}
async function switchMenu(page, area) {
  await page.locator(`a[href$="/daed/${area}"]:visible`).first().click()
  await page.frameLocator('iframe').locator(`[data-workspace="${area}"]`).waitFor()
}
async function waitText(locator, pattern) {
  for (let i = 0; i < 100; i++) {
    if (pattern.test(await locator.textContent())) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.match(await locator.textContent(), pattern)
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
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/cgi-bin/luci/admin/services/daed/dashboard`)
    await page.locator('input[name=luci_username]').fill('root')
    await page.locator('input[name=luci_password]').fill('fixture-password')
    await page.getByRole('button', { name: /Log in|登录/ }).click()
    const frame = page.frameLocator('iframe')
    await frame.locator('[data-workspace="dashboard"]').waitFor({ timeout: 45000 })
    const gql = async (query) => {
      const response = await context.request.post(`${base}/cgi-bin/daed-router/graphql`, {
        headers: { Origin: base },
        data: { query },
      })
      assert.equal(response.status(), 200)
      const value = await response.json()
      assert.ok(!value.errors, JSON.stringify(value.errors))
      return value.data
    }
    const resources =
      'query{configs{id name selected} dnss{id name selected dns{string}} routings{id name selected routing{string}} groups{id name policy nodes{id}} nodes{edges{id name link}} subscriptions{id tag link}}'
    const before = await gql(resources)
    const generalBefore = await gql('query{general{dae{running modified}}}')
    await control('snapshot')
    await frame.getByRole('button', { name: /NaiLink 版本/ }).click()
    const dialog = frame.getByRole('dialog')
    await waitText(dialog, /v0\.6\.99/)
    await frame.getByRole('button', { name: '更新到 0.6.99' }).click()
    await waitText(dialog, /正在备份、安装和恢复服务/)
    await page.keyboard.press('Escape')
    await switchMenu(page, 'advanced')
    await waitText(frame.locator('header'), /v0\.6\.99-1/)
    await frame.getByRole('button', { name: /NaiLink 版本/ }).click()
    await frame.getByRole('button', { name: '重新加载新版本' }).waitFor()
    await frame.getByRole('button', { name: '重新加载新版本' }).click()
    await frame.locator('[data-workspace="advanced"]').waitFor({ timeout: 45000 })
    assert.deepEqual(await gql(resources), before, 'update fixture changed user data')
    const card = frame.getByRole('region', { name: 'GeoIP 和 GeoSite 规则库' })
    // section has an accessible name, so it is a region in the browser tree.
    await card.getByRole('button', { name: '一键更新规则库' }).click()
    await waitText(card, /规则库已更新/)
    const first = await control('maintenance')
    assert.match(first.current, /^data-/)
    assert.deepEqual(await gql(resources), before)
    assert.deepEqual(
      await gql('query{general{dae{running modified}}}'),
      generalBefore,
      'rules update applied pending config or enabled the proxy',
    )
    await control('maintenance', { fail: 'checksum', bump: true })
    await card.getByRole('button', { name: '一键更新规则库' }).click()
    await waitText(card, /文件校验失败/)
    assert.equal((await control('maintenance')).current, first.current)
    await control('maintenance', { fail: 'invalid_geodata', bump: true })
    await card.getByRole('button', { name: '一键更新规则库' }).click()
    await waitText(card, /规则库格式或内容校验失败/)
    assert.equal((await control('maintenance')).current, first.current)
    await control('maintenance', { fail: '', custom: true })
    await card.getByRole('button', { name: '一键更新规则库' }).click()
    await waitText(card, /检测到自定义 GeoIP/)
    assert.equal((await control('maintenance')).current, first.current)
    await control('maintenance', { custom: false })
    await card.getByRole('button', { name: '一键更新规则库' }).click()
    await waitText(card, /规则库已更新/)
    const second = await control('maintenance')
    assert.notEqual(second.current, first.current)
    // Log colors are applied to inert text and keep continuation line severity.
    await control('logs', {
      text: 'time="now" level=info msg="normal"\ntime="now" level=warning msg="warning"\ncontinuation\ntime="now" level=error msg="<script>window.injected=1</script>"\n',
    })
    await switchMenu(page, 'logs')
    const pre = frame.locator('#router-log-output')
    await pre.locator('[data-log-level="error"]').waitFor()
    const colors = await pre
      .locator('[data-log-level]')
      .evaluateAll((elements) =>
        elements.map((element) => ({ level: element.dataset.logLevel, color: getComputedStyle(element).color })),
      )
    assert.equal(new Set(colors.map((item) => item.color)).size, 3)
    assert.equal(await frame.locator('body').evaluate(() => window.injected), undefined)
    await page.screenshot({ path: path.join(output, 'desktop-logs.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await switchMenu(page, 'advanced')
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const button = card.getByRole('button', { name: '一键更新规则库' })
    assert.equal(await button.evaluate((el) => el.getBoundingClientRect().height >= 44), true)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'mobile-geodata.png') })
    assert.deepEqual(errors, [])
    const result = {
      realLuCI: true,
      realRPC: true,
      realProcd: true,
      nativePackageLifecyclePreservedWorker: true,
      privateHTTPSFixture: true,
      backgroundUpdateAcrossNavigation: true,
      refreshRecovery: true,
      userDataPreserved: true,
      geodataPairActivation: true,
      checksumAndFormatFailurePreservedOldData: true,
      customDataPreserved: true,
      pendingConfigurationPreserved: true,
      logColors: colors,
      mobileNoOverflow: true,
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
