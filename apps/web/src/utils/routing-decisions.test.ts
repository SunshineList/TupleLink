import { describe, expect, it } from 'vitest'
import { exitGroupOf, exitKindOf, hasRoutingTrace, parseDecision, summarizeDecisions } from './routing-decisions'

// 取自 dae 实际输出格式：logrus 的 time=/level=/msg= 结构。
const log = (msg: string) => `time="2026-10-27T12:00:00Z" level=debug msg="${msg}"`

describe('路由决策解析', () => {
  it('从 set= 读出出口', () => {
    const item = parseDecision(log('routing match set len: 3/1024 set=proxy'))
    expect(item).toEqual({
      domain: '',
      host: '',
      target: 'proxy',
      kind: 'proxy',
      raw: expect.any(String),
    })
  })

  it('direct / block 有各自的分类', () => {
    expect(parseDecision(log('set=direct'))?.kind).toBe('direct')
    expect(parseDecision(log('set=block'))?.kind).toBe('block')
    expect(parseDecision(log('set=must_direct'))?.kind).toBe('must_direct')
  })

  it('outbound= 也能当决策依据', () => {
    expect(parseDecision(log('dial failed outbound=AI'))?.target).toBe('AI')
  })

  it('和路由无关的 debug 行不产生决策', () => {
    // 嗅探结果本身不是决策：后面的配置行还会改写动作。
    expect(parseDecision(log('sniffed domain: www.youtube.com'))).toBeNull()
    expect(parseDecision(log('Falling back to veth device creation'))).toBeNull()
    expect(parseDecision(log('so_mark_from_dae is unset'))).toBeNull()
  })

  it('认出域名和目标 IP', () => {
    const item = parseDecision(log('sniffed domain: www.youtube.com dest: 142.250.1.1 set=proxy'))
    expect(item?.domain).toBe('www.youtube.com')
    expect(item?.host).toBe('142.250.1.1')
  })

  it('群组名保持原样，不擅自小写', () => {
    // 群组名大小写敏感，改了就对不上真实配置。
    expect(parseDecision(log('set=MyGroup'))?.target).toBe('MyGroup')
    expect(parseDecision(log('set=MyGroup'))?.kind).toBe('proxy')
  })

  it('空的 set= 不当作出口', () => {
    expect(parseDecision(log('set='))).toBeNull()
  })
})

describe('出口分类', () => {
  it('must_direct 归到直连一组', () => {
    expect(exitGroupOf('must_direct')).toBe('direct')
    expect(exitGroupOf('proxy')).toBe('proxy')
    expect(exitGroupOf('block')).toBe('block')
  })

  it('未知取值当群组名处理', () => {
    expect(exitKindOf('AI')).toBe('proxy')
    expect(exitKindOf('')).toBe('unknown')
  })
})

describe('区分「没开 debug」和「没流量」', () => {
  it('有路由行时为真', () => {
    expect(hasRoutingTrace([log('routing match set len: 3/1024 set=proxy')])).toBe(true)
  })

  it('只有普通 info 日志时为假', () => {
    // 默认 log_level=info 时内核只输出这些，界面上必须提示去改级别。
    expect(
      hasRoutingTrace([log('Ready'), log('Created veth device pair (kernel v6.6.119 does not support Netkit)')]),
    ).toBe(false)
  })
})

describe('按域名归并', () => {
  const make = (domain: string, target: string) => ({
    domain,
    host: '',
    target,
    kind: exitKindOf(target),
    raw: `${domain} set=${target}`,
  })

  it('同域名只留最后一次决策', () => {
    const merged = summarizeDecisions([make('a.com', 'proxy'), make('a.com', 'direct'), make('b.com', 'block')])
    // 最新的在最前，a.com 只剩 direct。
    expect(merged.map((item) => [item.domain, item.target])).toEqual([
      ['b.com', 'block'],
      ['a.com', 'direct'],
    ])
  })

  it('没有域名时退回目标 IP 归并', () => {
    const merged = summarizeDecisions([{ domain: '', host: '1.1.1.1', target: 'proxy', kind: 'proxy', raw: '' }])
    expect(merged).toHaveLength(1)
  })

  it('域名与 IP 都缺失的行被丢弃，不占位置', () => {
    const merged = summarizeDecisions([
      { domain: '', host: '', target: 'proxy', kind: 'proxy', raw: 'x' },
      make('a.com', 'proxy'),
    ])
    expect(merged).toHaveLength(1)
  })

  it('超过上限时保留最新的那些', () => {
    const many = Array.from({ length: 60 }, (_, i) => make(`n${i}.com`, 'proxy'))
    const merged = summarizeDecisions(many, 10)
    expect(merged).toHaveLength(10)
    expect(merged[0].domain).toBe('n59.com')
  })
})
