import { describe, expect, it } from 'vitest'
import { activeCandidates, readGroupCandidates, selectionIsRandom } from './group-candidates'

/** 测试里伪造 window：直接赋值会被 Window 类型拦住，用 defineProperty 绕开。 */
function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true })
}

const group = (over: Partial<Parameters<typeof activeCandidates>[0]> = {}) => ({
  name: 'proxy',
  policy: 'min_moving_avg',
  candidateIPv4: '',
  candidateIPv6: '',
  members: 3,
  ...over,
})

describe('当前选中节点', () => {
  it('双栈选出同一节点时只显示一次', () => {
    // 两个协议族都选了同一个节点，显示两遍只会让人以为有两个在跑。
    expect(activeCandidates(group({ candidateIPv4: 'HK-01', candidateIPv6: 'HK-01' }))).toEqual(['HK-01'])
  })

  it('双栈选到不同节点时都保留', () => {
    expect(activeCandidates(group({ candidateIPv4: 'HK-01', candidateIPv6: 'JP-02' }))).toEqual(['HK-01', 'JP-02'])
  })

  it('只有 v4 时只显示 v4', () => {
    expect(activeCandidates(group({ candidateIPv4: 'HK-01' }))).toEqual(['HK-01'])
  })

  it('都没选出来时是空数组，由界面决定文案', () => {
    expect(activeCandidates(group())).toEqual([])
  })
})

describe('随机策略', () => {
  it('认得出来', () => {
    expect(selectionIsRandom('random')).toBe(true)
    expect(selectionIsRandom('Random')).toBe(true)
  })

  it('其他策略不算随机', () => {
    expect(selectionIsRandom('min_moving_avg')).toBe(false)
    expect(selectionIsRandom('')).toBe(false)
  })
})

describe('读取的防御', () => {
  it('不在 LuCI 里时报错', async () => {
    const original = globalThis.window
    const fake: Record<string, unknown> = {}
    fake.parent = fake
    setWindow(fake)
    await expect(readGroupCandidates()).rejects.toThrow('LuCI host unavailable')
    globalThis.window = original
  })

  it('载荷不是数组时返回不可用，而不是空群组', async () => {
    // 这两种情况的界面表现必须不同：前者是「读不到」，后者是「确实没有」。
    const original = globalThis.window
    setWindow({ parent: { L: { require: async () => ({ declare: () => async () => ({ groups: 'nope' }) }) } } })
    await expect(readGroupCandidates()).resolves.toEqual({ groups: [], available: false })
    globalThis.window = original
  })

  it('丢掉没有名字的行，保留有效字段', async () => {
    const original = globalThis.window
    setWindow({
      parent: {
        L: {
          require: async () => ({
            declare: () => async () => ({
              groups: [
                { name: '', policy: 'x' },
                { name: 'proxy', policy: 'min', candidate_ipv4: 'HK-01', members: '2' },
                null,
                { name: 'AI', members: 'not-a-number' },
              ],
            }),
          }),
        },
      },
    })
    const result = await readGroupCandidates()
    expect(result.available).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0]).toMatchObject({ name: 'proxy', candidateIPv4: 'HK-01', members: 2 })
    expect(result.groups[1]).toMatchObject({ name: 'AI', members: null })
    globalThis.window = original
  })
})
