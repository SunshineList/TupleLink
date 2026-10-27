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
