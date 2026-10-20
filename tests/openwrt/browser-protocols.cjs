/* Isolated native LuCI fixture: real API, synthetic credentials, no production router. */
const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { chromium } = require('playwright')
const base = process.env.DAED_PANEL_URL || 'http://localhost:18080'
const output = process.env.DAED_PROTOCOL_OUTPUT || '.build/protocol-browser'
fs.mkdirSync(output, { recursive: true })
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
    let udpRequests = 0
    page.on('request', (request) => {
      if ((request.postData() || '').includes('mutation TestNodeUDP')) udpRequests++
    })
    await page.goto(`${base}/cgi-bin/luci/admin/services/daed/resources`)
    if (await page.locator('input[name=luci_username]').count()) {
      await page.locator('input[name=luci_username]').fill('root')
      await page.locator('input[name=luci_password]').fill('fixture-password')
      await page.getByRole('button', { name: /Log in|登录/ }).click()
    }
    const f = page.frameLocator('iframe')
    await f.locator('[data-workspace="resources"]').waitFor({ timeout: 45000 })
    const gql = async (query, variables = {}) => {
      const response = await context.request.post(`${base}/cgi-bin/daed-router/graphql`, {
        headers: { Origin: base },
        data: { query, variables },
      })
      assert.equal(response.status(), 200)
      const data = await response.json()
      assert.ok(!data.errors, JSON.stringify(data.errors))
      return data.data
    }
    const key = Buffer.alloc(16, 255).toString('base64')
    const prefix = `Protocol-${Date.now()}`
    const profiles = [
      {
        kind: 'SS2022',
        link: `ss://2022-blake3-aes-128-gcm:${encodeURIComponent(key)}@127.0.0.1:9/?custom=%2B%2F&custom=b#Original`,
      },
      {
        kind: 'HY2',
        link: 'hy2://fixture%3Apass%40word@127.0.0.1:9/?obfs=salamander&obfsPassword=fixture-password&mport=9000-9001&insecure=1&custom=kept#Original',
      },
      { kind: 'AnyTLS', link: 'anytls://fixture%3A%40%2B%2F@127.0.0.1:9/?allowInsecure=true&custom=kept#Original' },
      {
        kind: 'VLESS',
        link: 'vless://11111111-1111-4111-8111-111111111111@127.0.0.1:9?type=ws&security=tls&sni=fixture.test&path=%2Fws&packetEncoding=xudp&custom=kept#Original',
      },
    ]
    const imported = await gql(
      'mutation($args:[ImportArgument!]!){importNodes(rollbackError:true,args:$args){node{id name tag link}}}',
      { args: profiles.map((p) => ({ link: p.link, tag: `${prefix}-${p.kind}` })) },
    )
    const nodes = imported.importNodes.map((item) => item.node)
    const manual = f.locator('#workspace-nodes')
    // Refresh the retained workspace's query after fixture-only API seeding.
    await page.reload()
    await f.locator('[data-workspace="resources"]').waitFor()
    await manual.getByRole('searchbox').fill(prefix)
    for (const profile of profiles) {
      const model = nodes.find((n) => n.tag === `${prefix}-${profile.kind}`)
      const card = manual.locator(`[data-node-id="${model.id}"]`)
      await card.locator('.panel-node-more').click()
      await f.getByRole('menuitem', { name: '编辑', exact: true }).click()
      const dialog = f.getByRole('dialog')
      await dialog.getByRole('textbox', { name: '名字', exact: true }).fill(`Edited-${profile.kind}`)
      if (profile.kind === 'SS2022') {
        await dialog.getByRole('combobox', { name: /Method/ }).click()
        assert.equal(
          await f
            .getByRole('option')
            .filter({ hasText: /^2022-blake3/ })
            .count(),
          3,
        )
        await f.getByRole('option', { name: '2022-blake3-aes-128-gcm', exact: true }).click()
        await dialog.getByRole('textbox', { name: /主机地址/ }).fill('::1')
      }
      if (profile.kind === 'AnyTLS') await dialog.getByRole('checkbox').uncheck()
      await dialog.getByRole('button', { name: '提交', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      const current = (await gql('query{nodes{edges{id name link}}}')).nodes.edges.find((n) => n.id === model.id)
      const result = new URL(current.link)
      assert.equal(current.name, `Edited-${profile.kind}`)
      assert.deepEqual(result.searchParams.getAll('custom'), profile.kind === 'SS2022' ? ['+/', 'b'] : ['kept'])
      if (profile.kind === 'SS2022') {
        assert.equal(result.hostname, '[::1]')
        assert.equal(decodeURIComponent(result.password), key)
        assert.ok(current.link.startsWith('ss://2022-blake3-aes-128-gcm:'))
      }
      if (profile.kind === 'HY2') {
        assert.equal(result.searchParams.get('mport'), '9000-9001')
        assert.equal(result.searchParams.get('obfsPassword'), 'fixture-password')
        assert.equal(decodeURIComponent(result.username), 'fixture:pass@word')
      }
      if (profile.kind === 'AnyTLS') {
        assert.equal(result.searchParams.get('insecure'), '0')
        assert.equal(result.searchParams.has('allowInsecure'), false)
        assert.equal(decodeURIComponent(result.username), 'fixture:@+/')
      }
      if (profile.kind === 'VLESS') assert.equal(result.searchParams.get('packetEncoding'), 'xudp')
    }
    const testId = nodes.find((n) => n.tag === `${prefix}-SS2022`).id
    const latencyState = async () =>
      (await gql('query{nodeLatencies{ id alive testedAt latencyMs message }}')).nodeLatencies.sort((a, b) =>
        a.id.localeCompare(b.id),
      )
    const before = await latencyState()
    await manual.locator(`[data-node-details="${testId}"]`).click()
    const detail = f.getByRole('dialog')
    await detail.getByText('UDP 连通性（可选）', { exact: true }).click()
    const response = page.waitForResponse(
      (r) => r.url().includes('/graphql') && (r.request().postData() || '').includes('mutation TestNodeUDP'),
    )
    await detail.getByRole('button', { name: '测试 UDP', exact: true }).click()
    const payload = await (await response).json()
    assert.ok(!payload.errors, JSON.stringify(payload.errors))
    assert.equal(payload.data.testNodeUDP.id, testId)
    assert.equal(typeof payload.data.testNodeUDP.target, 'string')
    await detail.getByText('UDP DNS', { exact: true }).waitFor()
    assert.deepEqual(await latencyState(), before)
    await detail.screenshot({ path: path.join(output, 'desktop-udp.png') })
    await page.keyboard.press('Escape')
    await f.locator('#workspace-subscriptions').getByRole('button', { name: '查看节点', exact: true }).first().click()
    await f.locator('[data-subscription-node]').first().locator('.subscription-node-name').click()
    const subscriptionDetail = f
      .getByRole('dialog')
      .filter({ has: f.getByRole('heading', { name: '节点详情', exact: true }) })
    await subscriptionDetail.getByText('UDP 连通性（可选）', { exact: true }).click()
    assert.ok(await subscriptionDetail.getByRole('button', { name: '测试 UDP', exact: true }).isVisible())
    assert.equal(udpRequests, 1, 'Opening details must never start background UDP probes')
    await context.close()
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
    })
    page = await mobile.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/cgi-bin/luci/admin/services/daed/resources`)
    await page.locator('input[name=luci_username]').fill('root')
    await page.locator('input[name=luci_password]').fill('fixture-password')
    await page.getByRole('button', { name: /Log in|登录/ }).click()
    const mf = page.frameLocator('iframe')
    await mf.locator('[data-workspace="resources"]').waitFor({ timeout: 45000 })
    await mf.locator('#workspace-nodes').getByRole('searchbox').fill(`${prefix}-SS2022`)
    await mf.locator(`[data-node-details="${testId}"]`).tap()
    const md = mf.getByRole('dialog')
    await md.getByText('UDP 连通性（可选）', { exact: true }).tap()
    const button = md.getByRole('button', { name: '测试 UDP', exact: true })
    assert.ok((await button.boundingBox()).height >= 44)
    assert.equal(await md.evaluate((e) => e.scrollWidth > e.clientWidth + 1), false)
    await md.screenshot({ path: path.join(output, 'mobile-udp.png') })
    assert.deepEqual(errors, [])
    process.stdout.write(
      'PASS: real API edits SS2022/HY2/AnyTLS/VLESS preserve URI options, IPv6 and credentials; explicit UDP is separate from HTTP latency; desktop/mobile details\n',
    )
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({
        editedProtocols: profiles.map((p) => p.kind),
        preservedParameters: true,
        udpSeparate: true,
        mobileTouchTargets: true,
      }),
    )
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    }
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
