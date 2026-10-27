import { describe, expect, it } from 'vitest'
import { looksLikeBotToken, looksLikeChatId } from './notify-settings'

describe('bot token 格式', () => {
  it('认得真实形态', () => {
    // 数字:冒号+base64url，这是 Telegram 的固定格式。
    expect(looksLikeBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(true)
  })

  it('拒绝没有冒号的串', () => {
    expect(looksLikeBotToken('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false)
  })

  it('拒绝整段 URL（常见的粘贴错误）', () => {
    // 用户很容易把 api.telegram.org/bot<token>/... 整段粘进来。
    expect(looksLikeBotToken('https://api.telegram.org/bot123:AAH/sendMessage')).toBe(false)
  })

  it('拒绝含空白的值', () => {
    expect(looksLikeBotToken(' 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw ')).toBe(true)
    expect(looksLikeBotToken('123 456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false)
  })

  it('拒绝过短的串', () => {
    expect(looksLikeBotToken('123:abc')).toBe(false)
  })

  it('空值不算有效', () => {
    expect(looksLikeBotToken('')).toBe(false)
  })
})

describe('chat id 格式', () => {
  it('用户 id 是纯数字', () => {
    expect(looksLikeChatId('123456789')).toBe(true)
  })

  it('群组 id 带负号', () => {
    expect(looksLikeChatId('-1001234567890')).toBe(true)
  })

  it('频道用户名以 @ 开头', () => {
    expect(looksLikeChatId('@my_channel')).toBe(true)
  })

  it('拒绝没有 @ 的字母名', () => {
    expect(looksLikeChatId('my_channel')).toBe(false)
  })

  it('拒绝含空白的值', () => {
    expect(looksLikeChatId('123 456')).toBe(false)
  })

  it('空值不算有效', () => {
    expect(looksLikeChatId('')).toBe(false)
  })
})

describe('rPC 载荷约定', () => {
  // LuCI 的 rpc.declare 按 params 名组装：params[name] = args[i]。
  // rpcd 脚本在顶层 json_get_var 读字段，所以参数名必须与脚本一致。
  // 之前声明 params: ['input'] 却让脚本读顶层 enabled，载荷被包一层，
  // 保存等于什么都没写 —— 界面显示「没填」就是这么来的。
  function buildPayload(names: string[], args: unknown[]) {
    const payload: Record<string, unknown> = {}
    for (let i = 0; i < names.length; i++) payload[names[i]] = args[i]
    return payload
  }

  it('保存载荷的字段名与 rpcd 脚本一致', () => {
    const payload = buildPayload(['enabled', 'token', 'chat', 'clear_token'], [1, '123456789:AAtoken', '-100123', ''])
    // rpcd 里读的是这三个字段，缺一个就会静默失效。
    expect(payload.enabled).toBe(1)
    expect(payload.token).toBe('123456789:AAtoken')
    expect(payload.chat).toBe('-100123')
  })

  it('包一层 input 会让脚本读不到任何字段', () => {
    // 这是回归防线：谁再把 params 写成 ['input'] 就会失败。
    const wrong = buildPayload(['input'], [{ enabled: 1, token: 'T', chat: 'C' }])
    expect(wrong.enabled).toBeUndefined()
    expect(wrong.token).toBeUndefined()
    expect(wrong.chat).toBeUndefined()
  })

  it('留空表示不修改，不是写入空值', () => {
    // 用户只改 chat_id 时，token 必须保持原样，不能被打成空串。
    const payload = buildPayload(['enabled', 'token', 'chat', 'clear_token'], [1, '', '5275305034', ''])
    expect(payload.token).toBe('')
    expect(payload.chat).toBe('5275305034')
  })
})
