/* Native LuCI API-only group layout and real drag regression. Run after native_panel.py. */
const { chromium } = require('playwright')
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const output = process.env.DAED_GROUP_OUTPUT || '.build/group-browser'
fs.mkdirSync(output, { recursive: true })
const base = process.env.DAED_PANEL_URL || 'http://localhost:18080'
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.DAED_BROWSER_EXECUTABLE ? { executablePath: process.env.DAED_BROWSER_EXECUTABLE } : {}),
  })
  let debugPage
  try {
    const context = await browser.newContext({ viewport: { width: 1800, height: 1600 }, locale: 'zh-CN' })
    const page = await context.newPage()
    debugPage = page
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && /pangea|Invariant|nested scroll/.test(m.text())) errors.push(m.text())
    })
    if (process.env.DAED_GROUP_PREVIEW_DIST) {
      const dist = path.resolve(process.env.DAED_GROUP_PREVIEW_DIST)
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
    await page.goto(base + '/cgi-bin/luci/admin/services/daed')
    if (await page.locator('input[name=luci_username]').count()) {
      await page.locator('input[name=luci_username]').fill('root')
      await page.locator('input[name=luci_password]').fill('fixture-password')
      await page.getByRole('button', { name: /Log in|登录/ }).click()
    }
    const f = page.frameLocator('iframe')
    await f.getByRole('button', { name: '主题', exact: true }).waitFor()
    const gql = async (query, variables = {}) => {
      const r = await context.request.post(base + '/cgi-bin/daed-router/graphql', {
        headers: { Origin: base },
        data: { query, variables },
      })
      const b = await r.json()
      assert.ok(!b.errors, JSON.stringify(b.errors))
      return b.data
    }
    const group = (
      await gql(`mutation {createGroup(name:"CompactLayout${Date.now()}",policy:fixed,policyParams:[]){id}}`)
    ).createGroup.id
    const empty = (
      await gql(`mutation {createGroup(name:"CompactEmpty${Date.now()}",policy:fixed,policyParams:[]){id}}`)
    ).createGroup.id
    const seedSuffix = Date.now().toString(36)
    const ids = (
      await gql('mutation($args:[ImportArgument!]!){importNodes(rollbackError:true,args:$args){node{id}}}', {
        args: Array.from({ length: 6 }, (_, i) => ({
          tag: (i === 0 ? '香港01 · ' + 'VeryLongNodeName中文'.repeat(8) : '香港0' + (i + 1)) + seedSuffix,
          link: `vless://33333333-3333-4333-8333-00000000000${i}@192.0.2.${i + 1}:443?encryption=none#HK${i}`,
        })),
      })
    ).importNodes.map((x) => x.node.id)
    await gql('mutation($id:ID!,$nodes:[ID!]!){groupAddNodes(id:$id,nodeIDs:$nodes)}', { id: group, nodes: ids })
    for (const tag of ['订阅一', '订阅二']) {
      const sub = (
        await gql('mutation($arg:ImportArgument!){importSubscription(rollbackError:true,arg:$arg){sub{id}}}', {
          arg: { tag: tag + seedSuffix, link: 'http://127.0.0.1:18081/sub-a' },
        })
      ).importSubscription.sub.id
      await gql(
        'mutation($id:ID!,$subs:[ID!]!){groupAddSubscriptions(id:$id,subscriptionIDs:$subs,nameFilterRegex:"HK")}',
        { id: group, subs: [sub] },
      )
    }
    await page.reload()
    await f.getByRole('button', { name: '主题', exact: true }).waitFor()
    // Use the wide outer LuCI container typical of Argon; the embedded layout is unchanged.
    await page.addStyleTag({
      content: 'body > .container, .container {width:1500px!important;max-width:calc(100vw - 40px)!important}',
    })
    await f.locator('.panel-workspace').evaluate((e) => (e.style.gridTemplateColumns = 'minmax(0,1fr) 600px'))
    const card = f.locator(`[data-group-card-id="${group}"]`)
    await card.getByRole('button', { name: /^管理成员 CompactLayout/ }).click()
    const content = card.locator('[data-group-content]')
    await content.locator('[data-group-columns="2"]').first().waitFor()
    const nodes = content.locator('[data-group-section=node]'),
      subs = content.locator('[data-group-section=subscription]')
    assert.equal(await nodes.locator('[data-group-column="0"] [data-group-member]').count(), 3)
    assert.equal(await nodes.locator('[data-group-column="1"] [data-group-member]').count(), 3)
    assert.equal(await subs.locator('[data-group-column="0"] [data-group-member]').count(), 1)
    assert.equal(await subs.locator('[data-group-column="1"] [data-group-member]').count(), 1)
    const subColumn = subs.locator('[data-group-column="0"]')
    const subMember = subColumn.locator('[data-group-member]')
    assert.ok(
      Math.abs((await subColumn.boundingBox()).width - (await subMember.boundingBox()).width) < 2,
      'Subscription tooltip must not shrink the card width',
    )

    assert.equal(
      await card
        .locator('[data-group-summary]')
        .getByText(/VeryLongNodeName/)
        .count(),
      0,
    )
    const firstShort = nodes.locator('[data-group-member]').filter({ hasText: '香港02' })
    assert.ok((await firstShort.boundingBox()).height <= 75)
    assert.ok(await content.evaluate((e) => e.scrollWidth <= e.clientWidth + 1))
    const snapshot = await gql('query{groups{id nodes{id} subscriptions{subscription{id} nameFilterRegex}}}')
    const drag = async (id, key) => {
      const h = card.locator(`[data-rfd-drag-handle-draggable-id="${group}-node-${id}"]`)
      await h.scrollIntoViewIfNeeded()
      await h.focus()
      await page.keyboard.press('Space')
      await page.waitForTimeout(150)
      await page.keyboard.press(key)
      await page.waitForTimeout(200)
      await page.keyboard.press('Space')
      await page.waitForTimeout(250)
    }
    await drag(ids[3], 'ArrowDown')
    let order = await nodes
      .locator('[data-group-member]')
      .evaluateAll((es) => es.map((e) => e.getAttribute('data-rfd-draggable-id')))
    assert.deepEqual(
      order,
      [ids[0], ids[1], ids[2], ids[4], ids[3], ids[5]].map((id) => `${group}-node-${id}`),
    )
    await drag(ids[1], 'ArrowRight')
    order = await nodes
      .locator('[data-group-member]')
      .evaluateAll((es) => es.map((e) => e.getAttribute('data-rfd-draggable-id')))
    assert.notEqual(order.indexOf(`${group}-node-${ids[1]}`), 1)
    assert.equal(new Set(order).size, 6)
    assert.deepEqual(await gql('query{groups{id nodes{id} subscriptions{subscription{id} nameFilterRegex}}}'), snapshot)
    const subOrderBefore = await subs
      .locator('[data-group-member]')
      .evaluateAll((es) => es.map((e) => e.getAttribute('data-rfd-draggable-id')))
    const subHandles = subs.locator('[data-rfd-drag-handle-draggable-id]')
    // Earlier regression suites can leave many groups above this fixture. Keep
    // both columns inside the iframe viewport before directional keyboard drag.
    await subs.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(200)
    await subHandles.first().scrollIntoViewIfNeeded()
    await subHandles.first().focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    await page.keyboard.press('Space')
    await page.waitForTimeout(250)
    assert.deepEqual(
      await subs
        .locator('[data-group-member]')
        .evaluateAll((es) => es.map((e) => e.getAttribute('data-rfd-draggable-id'))),
      subOrderBefore.reverse(),
    )
    const emptyCard = f.locator(`[data-group-card-id="${empty}"]`)
    await emptyCard.getByRole('button', { name: /^管理成员 CompactEmpty/ }).click()
    assert.equal(await emptyCard.getByText('暂无内容', { exact: true }).count(), 0)
    assert.ok((await emptyCard.boundingBox()).height < 190)
    const pointerDrag = async (handle, target) => {
      await handle.scrollIntoViewIfNeeded()
      await target.scrollIntoViewIfNeeded()
      const start = await handle.boundingBox()
      const end = await target.boundingBox()
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, { steps: 5 })
      await page.waitForTimeout(200)
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 })
      await page.waitForTimeout(250)
      await page.mouse.up()
      await page.waitForTimeout(350)
    }
    const rightHandle = nodes.locator('[data-group-column="1"] [data-rfd-drag-handle-draggable-id]').first()
    const leftTarget = nodes.locator('[data-group-column="0"] [data-group-member]').last()
    await pointerDrag(rightHandle, leftTarget)
    const pointerOrder = await nodes
      .locator('[data-group-member]')
      .evaluateAll((es) => es.map((e) => e.getAttribute('data-rfd-draggable-id')))
    assert.notDeepEqual(pointerOrder, order, 'Pointer drag must reorder across columns')
    order = pointerOrder
    assert.equal(new Set(order).size, 6)
    const crossHandle = nodes.locator('[data-group-column="1"] [data-rfd-drag-handle-draggable-id]').first()
    const draggedId = (await crossHandle.getAttribute('data-rfd-drag-handle-draggable-id')).replace(
      group + '-node-',
      '',
    )
    await pointerDrag(crossHandle, emptyCard.locator('[data-slot=card]').first())
    const targetState = (await gql('query{groups{id nodes{id}}}')).groups
    assert.ok(targetState.find((g) => g.id === empty).nodes.some((n) => n.id === draggedId))
    assert.equal(
      targetState.find((g) => g.id === group).nodes.length,
      6,
      'Cross-group add must retain original members',
    )
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
    await card.screenshot({ path: path.join(output, 'group-expanded.png') })
    await emptyCard.screenshot({ path: path.join(output, 'group-empty.png') })
    // Reload retains the order despite responsive reflow.
    await page.reload()
    await f.getByRole('button', { name: '主题', exact: true }).waitFor()
    await page.addStyleTag({
      content: 'body > .container, .container {width:1500px!important;max-width:calc(100vw - 40px)!important}',
    })
    await f.locator('.panel-workspace').evaluate((e) => (e.style.gridTemplateColumns = 'minmax(0,1fr) 600px'))
    await card.getByRole('button', { name: /^管理成员 CompactLayout/ }).click()
    await page.waitForTimeout(350)
    assert.deepEqual(
      await nodes
        .locator('[data-group-member]')
        .evaluateAll((es) => es.map((e) => e.getAttribute('data-rfd-draggable-id'))),
      order,
    )
    await f.locator('.panel-workspace').evaluate((e) => (e.style.gridTemplateColumns = ''))
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.waitForTimeout(400)
    assert.equal(await nodes.locator('[data-group-column="1"]').isVisible(), false)
    assert.equal(await nodes.locator('[data-group-column="0"] [data-group-member]').count(), 6)
    assert.ok(await content.evaluate((e) => e.scrollWidth <= e.clientWidth + 1))
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log(
      'PASS: compact two-column node/subscription members, full names, empty groups, keyboard sorting within/across columns, pointer cross-column/cross-group drag, persistent order, responsive single column and preserved bindings',
    )
  } catch (e) {
    if (debugPage) {
      await debugPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
      console.log(
        await debugPage
          .frameLocator('iframe')
          .locator('[data-group-card-id]')
          .evaluateAll((es) =>
            es.map((e) => ({
              name: e.innerText.slice(0, 60),
              width: e.clientWidth,
              content: e.querySelector('[data-group-content]')?.clientWidth,
              cols: e.querySelector('[data-group-columns]')?.dataset.groupColumns,
            })),
          ),
      )
    }
    throw e
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
