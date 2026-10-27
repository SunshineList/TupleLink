import { describe, expect, it } from 'vitest'
import { describeExit, proxyInEffect, readExitIP } from './exit-ip'

/** 测试里伪造 window：直接赋值会被 Window 类型拦住，用 defineProperty 绕开。 */
function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true })
}

const make = (direct: string, proxied: string, verdict: 'same' | 'different' | 'unknown') => ({
  direct,
  proxied,
  verdict,
})

describe('出口比对结论', () => {
  it('出口不同说明代理确实起作用', () => {
    expect(proxyInEffect(make('1.1.1.1', '2.2.2.2', 'different'))).toBe(true)
  })

  it('出口相同不算生效', () => {
    // 也可能是没走代理，或代理落地恰好同城，不能断言分流坏了。
    expect(proxyInEffect(make('1.1.1.1', '1.1.1.1', 'same'))).toBe(false)
  })

  it('探测失败时不作判断', () => {
    expect(proxyInEffect(make('', '', 'unknown'))).toBe(false)
    expect(proxyInEffect(undefined)).toBe(false)
  })

  it('没有结果时给 unknown 文案', () => {
    expect(describeExit(undefined)).toBe('exitIP.unknown')
    expect(describeExit(make('', '', 'unknown'))).toBe('exitIP.unknown')
  })

  it('different 与 same 各自有对应文案', () => {
    expect(describeExit(make('1.1.1.1', '2.2.2.2', 'different'))).toBe('exitIP.different')
    expect(describeExit(make('1.1.1.1', '1.1.1.1', 'same'))).toBe('exitIP.same')
  })
})

describe('读取接口的防御', () => {
  it('不在 LuCI 里时明确报错', async () => {
    // 面板是 iframe，parent 恒等于 window 说明没被 LuCI 托管（直接开页面）。
    const original = globalThis.window
    const fake: Record<string, unknown> = {}
    fake.parent = fake
    setWindow(fake)
    await expect(readExitIP()).rejects.toThrow('LuCI host unavailable')
    globalThis.window = original
  })

  it('载荷缺失时按失败处理，不当成空结果', async () => {
    const original = globalThis.window
    setWindow({ parent: { L: { require: async () => ({ declare: () => async () => undefined }) } } })
    await expect(readExitIP()).rejects.toThrow('exitip unavailable')
    globalThis.window = original
  })

  it('字段类型不对时降级成 unknown，不抛错', async () => {
    const original = globalThis.window
    setWindow({
      parent: {
        L: {
          require: async () => ({
            declare: () => async () => ({ direct: 123, proxied: null, verdict: 'weird' }),
          }),
        },
      },
    })
    await expect(readExitIP()).resolves.toEqual({ direct: '', proxied: '', verdict: 'unknown' })
    globalThis.window = original
  })
})
