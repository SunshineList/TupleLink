/* Auth compatibility against native_panel.py's disposable real LuCI/rpcd. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { chromium } = require('playwright')
const output = process.env.DAED_ACCESS_OUTPUT || '.build/access-browser'
fs.mkdirSync(output, { recursive: true })

async function signIn(page, base) {
  await page.goto(`${base}/cgi-bin/luci/admin/services/daed/dashboard`)
  if (await page.locator('input[name=luci_username]').count()) {
    await page.locator('input[name=luci_username]').fill('root')
    await page.locator('input[name=luci_password]').fill('fixture-password')
    await page.getByRole('button', { name: /Log in|登录/ }).click()
  }
}

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.DAED_BROWSER_EXECUTABLE ? { executablePath: process.env.DAED_BROWSER_EXECUTABLE } : {}),
  })
  const results = []
  try {
    for (const [label, base, width] of [
      ['http', 'http://localhost:18080', 1600],
      ['https', 'https://localhost:18443', 1600],
      ['mobile', 'http://localhost:18080', 390],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        ignoreHTTPSErrors: true,
        locale: 'zh-CN',
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      // The RPC module already holds the valid session, while the page env is
      // stale. Real status calls must still work, and the new bootstrap follows it.
      await context.route('**/view/daed-router/workspace.js*', async (route) => {
        const response = await route.fetch()
        const body = await response.text()
        await route.fulfill({
          response,
          body: body.replace(
            '// New module URL',
            'L.env.sessionid = "00000000000000000000000000000000";\n// New module URL',
          ),
        })
      })
      await signIn(page, base)
      await page.frameLocator('iframe').locator('[data-workspace="dashboard"]').waitFor({ timeout: 45000 })
      const cookies = await context.cookies()
      const cookie = cookies.find((item) => item.name === 'daed_luci_session')
      assert.ok(cookie && cookie.httpOnly)
      assert.equal(cookie.secure, label === 'https')
      const real = await context.request.post(`${base}/cgi-bin/daed-router/session`, {
        headers: { Origin: base },
        data: { session: cookie.value },
      })
      assert.equal(real.status(), 204)
      const csrf = await context.request.post(`${base}/cgi-bin/daed-router/session`, {
        headers: { Origin: 'https://evil.test' },
        data: { session: cookie.value },
      })
      assert.equal(csrf.status(), 403)
      assert.equal((await csrf.json()).code, 'origin_rejected')
      for (const [status, code, message] of [
        [403, 'permission_denied', '管理权限'],
        [403, 'origin_rejected', '来源校验'],
        [503, 'rpc_unavailable', '授权服务不可用'],
        [404, 'gateway_missing', '没有找到'],
        [200, null, '内容异常'],
      ]) {
        await context.route('**/cgi-bin/daed-router/session', (route) =>
          route.fulfill({
            status,
            contentType: code ? 'application/json' : 'text/html',
            body: code ? JSON.stringify({ code }) : '<html>unexpected login</html>',
          }),
        )
        await page.reload()
        await page.getByRole('alert').waitFor()
        assert.match(await page.getByRole('alert').textContent(), new RegExp(message))
        assert.equal(await page.locator('iframe').count(), 0)
        assert.equal(
          await page
            .getByRole('button', { name: '重新加载' })
            .evaluate((el) => el.getBoundingClientRect().height >= 44),
          true,
        )
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.screenshot({ path: path.join(output, `${label}-${code || 'invalid_response'}.png`) })
        await context.unroute('**/cgi-bin/daed-router/session')
      }
      await page.getByRole('button', { name: '重新加载' }).click()
      await page.frameLocator('iframe').locator('[data-workspace="dashboard"]').waitFor({ timeout: 45000 })
      assert.deepEqual(errors, [])
      results.push({ label, activeRPCSession: true, csrf: true, diagnostics: true, retry: true })
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2))
    process.stdout.write(`${JSON.stringify(results)}\n`)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
