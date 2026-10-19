const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
/* Native UI regression for recoverable testing and filtered multi-selection. */
const { chromium } = require('playwright')
const base = process.env.DAED_PANEL_URL || 'http://localhost:18080'
const output = process.env.DAED_TESTING_OUTPUT || '.build/testing-browser'
fs.mkdirSync(output, { recursive: true })
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.DAED_BROWSER_EXECUTABLE ? { executablePath: process.env.DAED_BROWSER_EXECUTABLE } : {}),
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1800, height: 1050 }, locale: 'zh-CN' })
    const page = await context.newPage()
    if (process.env.DAED_RESOURCE_PREVIEW_DIST) {
      const dist = path.resolve(process.env.DAED_RESOURCE_PREVIEW_DIST)
      await page.route('**/cgi-bin/daed-router/**', async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const file = path.resolve(
          dist,
          new URL(route.request().url()).pathname.split('/cgi-bin/daed-router/')[1] || 'index.html',
        )
        if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) return route.continue()
        return route.fulfill({ path: file })
      })
    }
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}/cgi-bin/luci/admin/services/daed`)
    await page.locator('input[name=luci_username]').fill('root')
    await page.locator('input[name=luci_password]').fill('fixture-password')
    await page.getByRole('button', { name: /Log in|登录/ }).click()
    const f = page.frameLocator('iframe')
    await f.getByRole('button', { name: '主题', exact: true }).waitFor()
    const gql = async (query, variables = {}) => {
      const b = await (
        await context.request.post(`${base}/cgi-bin/daed-router/graphql`, {
          headers: { Origin: base },
          data: { query, variables },
        })
      ).json()
      assert.ok(!b.errors, JSON.stringify(b.errors))
      return b.data
    }
    const stamp = Date.now()
    const oldSources = (await gql('query{subscriptions{id tag}}')).subscriptions.filter((item) =>
      item.tag?.startsWith('Recovery-'),
    )
    if (oldSources.length)
      await gql('mutation($ids:[ID!]!){removeSubscriptions(ids:$ids)}', { ids: oldSources.map((item) => item.id) })
    const sources = []
    for (const label of ['a', 'b'])
      sources.push(
        (
          await gql('mutation($arg:ImportArgument!){importSubscription(rollbackError:true,arg:$arg){sub{id}}}', {
            arg: {
              tag: `Recovery-${label}-${stamp}`,
              link: `http://127.0.0.1:18081/sub-recovery-${label}?case=${stamp}`,
            },
          })
        ).importSubscription.sub.id,
      )
    const group = (
      await gql('mutation($name:String!){createGroup(name:$name,policy:fixed,policyParams:[]){id}}', {
        name: `Recovery${stamp}`,
      })
    ).createGroup.id
    await page.reload()
    await f.locator(`[data-group-card-id="${group}"]`).getByRole('button', { name: '添加节点', exact: true }).click()
    const picker = f.locator('[data-node-picker]')
    const search = picker.getByRole('searchbox')
    const source = picker.getByRole('combobox')
    await search.fill('Recovery-')
    assert.equal(await picker.locator('[data-picker-node]').count(), 132)
    await source.selectOption(sources[0])
    assert.equal(await picker.locator('[data-picker-node]').count(), 66)
    await picker.getByRole('button', { name: '全选当前', exact: true }).click()
    await source.selectOption(sources[1])
    await picker.getByRole('button', { name: '全选当前', exact: true }).click()
    await source.selectOption('all')
    assert.equal(await picker.locator('[data-selected="true"]').count(), 132)
    await picker.getByRole('button', { name: '只看已选', exact: true }).click()
    await picker.getByRole('button', { name: '清空选择', exact: true }).click()
    assert.equal(await picker.locator('[data-picker-node]').count(), 0)
    await picker.getByRole('button', { name: '只看已选', exact: true }).click()
    const first = picker.locator('[data-picker-node]').first()
    const selectedId = await first.getAttribute('data-picker-node')
    await first.locator('.picker-node-select').click()
    let mode = 'selected'
    let requests = []
    let attempts = new Map()
    let successful = new Set()
    await page.route('**/cgi-bin/daed-router/graphql', async (route) => {
      const b = route.request().postDataJSON()
      if (!b?.query?.includes('mutation TestNodeLatencies')) return route.continue()
      const id = b.variables.ids[0]
      requests.push(id)
      attempts.set(id, (attempts.get(id) || 0) + 1)
      await new Promise((resolve) => setTimeout(resolve, 35))
      if (
        (mode === 'transient' && requests.length >= 66 && attempts.get(id) < 3 && id === requests[65]) ||
        (mode === 'outage' && requests.length >= 66)
      )
        return route.fulfill({ status: 502, contentType: 'text/plain', body: 'Injected temporary gateway failure' })
      successful.add(id)
      const alive = mode !== 'transient' || successful.size % 5 !== 0
      return route.fulfill({
        json: { data: { testNodeLatencies: [{ id, alive, latencyMs: 125, testedAt: new Date().toISOString() }] } },
      })
    })
    const waitFinished = async () => {
      for (let i = 0; i < 300; i++) {
        await page.waitForTimeout(50)
        if (await picker.getByRole('button', { name: '测试当前结果', exact: true }).isEnabled()) return
      }
      throw new Error('Test queue did not finish')
    }
    await picker.getByRole('button', { name: '测试已选 (1)', exact: true }).click()
    await waitFinished()
    assert.deepEqual(requests, [selectedId])
    assert.equal(await first.getAttribute('data-selected'), 'true')
    mode = 'transient'
    requests = []
    attempts = new Map()
    successful = new Set()
    await picker.getByRole('button', { name: '测试当前结果', exact: true }).click()
    await waitFinished()
    assert.equal(successful.size, 132)
    assert.equal(await picker.getByRole('alert').count(), 0)
    assert.ok(requests.length > 132, 'A temporary error must be retried')
    await picker.getByText('已完成 132 / 132', { exact: true }).waitFor()
    const failedIds = await picker
      .locator('[data-picker-node]:has([data-latency-tone="bad"])')
      .evaluateAll((es) => es.map((e) => e.dataset.pickerNode))
    mode = 'retry'
    requests = []
    await picker.getByRole('button', { name: /重试失败项/ }).click()
    await waitFinished()
    assert.deepEqual(new Set(requests), new Set(failedIds))
    mode = 'outage'
    requests = []
    attempts = new Map()
    successful = new Set()
    await picker.getByRole('button', { name: '测试当前结果', exact: true }).click()
    await waitFinished()
    await picker.getByRole('alert').filter({ hasText: '测试已暂停' }).waitFor()
    assert.ok(successful.size > 0 && successful.size < 132)
    await picker.getByText(/已暂停 \d+ \/ 132/).waitFor()
    const finishedBefore = new Set(successful)
    mode = 'resume'
    requests = []
    await picker.getByRole('button', { name: /继续未完成/ }).click()
    await waitFinished()
    assert.ok(
      requests.every((id) => !finishedBefore.has(id)),
      'Continue must skip completed nodes',
    )
    assert.equal(successful.size, 132)
    await picker.getByText('已完成 132 / 132', { exact: true }).waitFor()
    assert.equal(await picker.getByRole('alert').count(), 0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    // Coarse-pointer CSS is separately exercised by the existing touch suite.
    const close = picker.locator('[data-slot="dialog-close"]')
    assert.ok((await close.boundingBox()).width >= 44)
    assert.ok((await search.boundingBox()).width > 250, 'Mobile search needs its own row')
    await page.screenshot({ path: path.join(output, 'mobile-recovery.png') })
    await page.setViewportSize({ width: 390, height: 420 })
    await search.focus()
    await page.waitForTimeout(250)
    assert.ok(
      await picker.evaluate((e) => e.scrollHeight <= e.clientHeight + 1),
      'Short viewports must keep the footer inside the dialog',
    )
    assert.ok(
      (await picker.locator('.node-picker-body').boundingBox()).height >= 32,
      'Short viewports must leave room for node results',
    )
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await page.setViewportSize({ width: 1800, height: 1050 })
    await f.locator(`[data-group-card-id="${group}"]`).getByRole('button', { name: '添加节点', exact: true }).click()
    await search.fill('Recovery-')
    await first.locator('.picker-node-select').click()
    await picker.getByRole('button', { name: '添加所选节点', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
    const bound = (await gql('query{groups{id nodes{id}}}')).groups.find((g) => g.id === group).nodes
    assert.deepEqual(
      bound.map((n) => n.id),
      [selectedId],
    )
    assert.deepEqual(errors, [])
    process.stdout.write(
      'PASS: 132 nodes, source filters, persistent multi-select, selected-only tests, transient retry, failed-only retry, pause/resume without repeating completed nodes, responsive search and actual group binding\n',
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
