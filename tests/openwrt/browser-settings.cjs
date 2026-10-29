/* Local LuCI fixture: runtime status, polling, drafts and navigation protection. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const process = require('node:process')
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'zh-Hans'))
    await page.route('**/cgi-bin/luci/admin/services/daed/*', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><style>body{margin:0}nav{height:36px;display:flex;gap:24px;padding:8px 20px;box-sizing:border-box}iframe{border:0;width:100vw;height:calc(100vh - 36px)}</style>
      <nav><a href="/cgi-bin/luci/admin/services/daed/advanced">设置</a><a href="/cgi-bin/luci/admin/services/daed/logs">日志</a></nav><script>
      window.fixture={state:{enabled:false,token_set:false,chat:''},mixed:{enabled:false,port:7893,lan:false,host:'192.168.8.1',runtime:{state:'disabled',address:''}},mirror:'',nextState:'listening',mixedReads:0,failMixed:false};
      window.L={require:async()=>({declare:spec=>async(...args)=>{
       const f=window.fixture,p=Object.fromEntries((spec.params||[]).map((n,i)=>[n,args[i]]));
       if(spec.method==='notify')return {...f.state};
       if(spec.method==='notifysave'){f.state={enabled:p.enabled===1,token_set:f.state.token_set||!!p.token,chat:p.chat||f.state.chat};return {success:true}}
       if(spec.method==='notifytest')return {code:'sent'};
       if(spec.method==='mixed'){f.mixedReads++;if(f.failMixed)throw new Error('fixture read failure');return structuredClone(f.mixed)}
       if(spec.method==='mixedsave'){f.mixed={...f.mixed,enabled:p.enabled===1,port:p.port,lan:p.lan===1,runtime:{state:p.enabled===1?f.nextState:'disabled',address:p.enabled===1?(p.lan?'192.168.8.1':'127.0.0.1')+':'+p.port:''}};return {success:true}}
       if(spec.method==='maintenance')return {success:true,current:'0.6.36',mirror:f.mirror,geodata:{version:'20261029'}};
       if(spec.method==='mirror'){f.mirror=p.url.replace(/\\/+$/,'');return {success:true}}
       if(spec.method==='groups')return {groups:[]};
       return {success:true,checks:[],listen:'127.0.0.1:2023'};
      }})};</script><iframe src="/advanced"></iframe>`,
      }),
    )
    const prefix = 'http://127.0.0.1:4199/cgi-bin/luci/admin/services/daed'
    await page.goto(`${prefix}/advanced`)
    const frame = page.frameLocator('iframe')
    const notify = frame
      .locator('section')
      .filter({ has: frame.locator('#notify-token') })
      .last()
    const mixed = frame
      .locator('section')
      .filter({ has: frame.locator('#mixed-port') })
      .last()
    const runtime = mixed.getByTestId('mixed-runtime')
    await frame.locator('#notify-token').fill('123456789:AAfixture_token_0123456789012345')
    await frame.locator('#notify-chat').fill('-100123')
    await notify.getByText('未保存', { exact: true }).waitFor()
    await notify.getByRole('button', { name: /发送测试/ }).click()
    await notify.getByText(/测试消息已发送/).waitFor()
    await notify.getByText('已保存', { exact: true }).waitFor()
    await frame.locator('#mixed-enabled').click()
    await frame.locator('#mixed-lan').click()
    await page.evaluate(() => {
      window.fixture.nextState = 'port_in_use'
    })
    await mixed.getByRole('button', { name: '保存', exact: true }).click()
    await runtime.getByText(/端口被其他服务占用/).waitFor()
    await mixed.getByText('已保存', { exact: true }).waitFor()
    // The port can be saved while its listener is unavailable.
    assert.equal(await runtime.getByText(/端口正在监听/).count(), 0)
    await mixed.getByRole('button', { name: '重新应用', exact: true }).waitFor()
    // Polling must not overwrite drafts, including external config changes.
    await frame.locator('#mixed-port').fill('7894')
    const reads = await page.evaluate(() => {
      window.fixture.mixed.port = 8000
      return window.fixture.mixedReads
    })
    await page.waitForFunction((reads) => window.fixture.mixedReads > reads, reads)
    assert.equal(await frame.locator('#mixed-port').inputValue(), '7894')
    await mixed.getByText('未保存', { exact: true }).waitFor()
    // Cancel a real LuCI menu change before either URL or content changes.
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('link', { name: '日志', exact: true }).click()
    assert.equal(page.url(), `${prefix}/advanced`)
    assert.equal(await frame.locator('#mixed-port').inputValue(), '7894')
    // Closing/reloading the outer page has the same protection.
    let reloadPrompt = false
    page.once('dialog', async (dialog) => {
      reloadPrompt = dialog.type() === 'beforeunload'
      await dialog.dismiss()
    })
    await page.reload({ timeout: 5000 }).catch(() => {})
    assert.ok(reloadPrompt, 'Outer reload must prompt for unsaved iframe settings')
    await page.evaluate(() => {
      window.fixture.nextState = 'listening'
    })
    await mixed.getByRole('button', { name: '保存', exact: true }).click()
    await runtime.getByText(/端口正在监听/).waitFor()
    await mixed.getByText('192.168.8.1:7894', { exact: true }).first().waitFor()
    // Read failure hides stale success status while preserving a new draft.
    await frame.locator('#mixed-port').fill('7895')
    await page.evaluate(() => {
      window.fixture.failMixed = true
    })
    await mixed.getByText(/暂时无法刷新运行状态/).waitFor({ timeout: 7000 })
    assert.equal(await frame.locator('#mixed-port').inputValue(), '7895')
    assert.equal(await runtime.getByText(/端口正在监听/).count(), 0)
    await page.evaluate(() => {
      window.fixture.failMixed = false
    })
    await mixed.getByRole('button', { name: '刷新状态' }).click()
    await runtime.getByText(/端口正在监听/).waitFor()
    await mixed.getByRole('button', { name: '撤销修改' }).click()
    // A different settings section also participates in the guard.
    await frame.locator('#github-mirror').fill('https://mirror.example')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('link', { name: '日志', exact: true }).click()
    assert.equal(page.url(), `${prefix}/advanced`)
    await frame.getByRole('button', { name: '保存代理', exact: true }).click()
    // The enabled button disappears after save readback, before navigation.
    await page.waitForFunction(() => window.fixture.mirror === 'https://mirror.example')
    await frame.getByRole('button', { name: '保存代理', exact: true }).waitFor()
    await page.waitForFunction(() =>
      document.querySelector('iframe').contentDocument.querySelector('button[type="submit"]:disabled'),
    )
    const out = process.env.SETTINGS_PREVIEW_DIR || '/tmp/tuplelink-settings-preview'
    fs.mkdirSync(out, { recursive: true })
    await frame.locator('[data-sonner-toast]').last().waitFor({ state: 'hidden', timeout: 10000 })
    await frame.locator('#panel-device-settings').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/desktop.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await frame.locator('#mixed-port').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/mobile.png` })
    const overflow = await page
      .frames()[1]
      .evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(overflow.scroll <= overflow.width, `Mobile overflow: ${JSON.stringify(overflow)}`)
    // Saved settings allow menu navigation. Parent Back cancellation keeps URL
    // and iframe aligned; accepting it discards the draft.
    await page.getByRole('link', { name: '日志', exact: true }).click()
    await frame.locator('[data-workspace="logs"]').waitFor()
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await frame.locator('#mixed-port').fill('7896')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.goBack()
    await frame.locator('[data-workspace="advanced"]').waitFor()
    assert.equal(page.url(), `${prefix}/advanced`)
    assert.equal(await frame.locator('#mixed-port').inputValue(), '7896')
    page.once('dialog', (dialog) => dialog.accept())
    await page.goBack()
    await frame.locator('[data-workspace="logs"]').waitFor()
    console.log(
      'Settings UI passed: runtime errors/readiness, draft polling, save readback, menu/reload/back guards, mobile layout.',
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
