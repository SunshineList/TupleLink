import { describe, expect, it } from 'vitest'
import { hasGeoIP, hasGeoSite } from './geodata-codes'
import {
  actionEquals,
  actionTarget,
  customRuleOf,
  DEFAULT_SERVICE_RULES,
  matcherOf,
  parseCustomRules,
  parseServiceRules,
  ROUTING_SERVICES,
  ruleLine,
  serviceById,
  writeRules,
  writeServiceRules,
} from './routing-services'

const BASE = [
  'pname(NetworkManager, systemd-resolved, dnsmasq) -> must_direct',
  'dip(geoip:private) -> direct',
  'domain(geosite:cn) -> direct',
  'fallback: proxy',
  '',
].join('\n')

describe('routing services', () => {
  it('keeps the service catalog free of duplicate matchers', () => {
    const seen = new Set<string>()
    for (const service of ROUTING_SERVICES) {
      expect(seen.has(service.matcher), `duplicate matcher for ${service.id}`).toBe(false)
      seen.add(service.matcher)
    }
  })

  it('resolves a service by id', () => {
    expect(serviceById('youtube')?.matcher).toBe('domain(geosite:youtube)')
    expect(serviceById('lan')?.proxyByDefault).toBe(false)
  })

  it('renders a rule line with one space around the arrow', () => {
    expect(ruleLine('domain(geosite:youtube)', 'proxy')).toBe('domain(geosite:youtube) -> proxy')
  })

  it('maps actions to routingA targets', () => {
    expect(actionTarget({ kind: 'group', group: 'proxy' })).toBe('proxy')
    expect(actionTarget({ kind: 'direct' })).toBe('direct')
    expect(actionTarget({ kind: 'block' })).toBe('block')
  })

  it('compares actions structurally', () => {
    expect(actionEquals({ kind: 'group', group: 'proxy' }, { kind: 'group', group: 'proxy' })).toBe(true)
    expect(actionEquals({ kind: 'group', group: 'proxy' }, { kind: 'group', group: 'us' })).toBe(false)
    expect(actionEquals({ kind: 'direct' }, { kind: 'direct' })).toBe(true)
    expect(actionEquals(undefined, { kind: 'direct' })).toBe(false)
  })

  it('parses known service lines and ignores fallback', () => {
    const parsed = parseServiceRules(`${BASE}\ndomain(geosite:youtube) -> us\ndomain(geosite:netflix) -> block\n`)
    expect(parsed.get('youtube')).toEqual({ kind: 'group', group: 'us' })
    expect(parsed.get('netflix')).toEqual({ kind: 'block' })
    expect(parsed.get('cn')).toEqual({ kind: 'direct' })
    expect(parsed.get('lan')).toEqual({ kind: 'direct' })
  })

  it('treats must_direct as direct', () => {
    const parsed = parseServiceRules('l4proto(udp) && dport(1000-65535) -> must_direct\n')
    expect(parsed.get('game-udp')).toEqual({ kind: 'direct' })
  })

  it('ignores hand written lines it does not understand', () => {
    const parsed = parseServiceRules('domain(suffix:internal.example) -> direct\nfallback: proxy\n')
    expect(parsed.size).toBe(0)
  })

  it('writes new rules above the fallback line', () => {
    const text = writeServiceRules(BASE, [
      { service: 'youtube', action: { kind: 'group', group: 'us' } },
    ])
    const lines = text.trim().split('\n')
    expect(lines[lines.length - 2]).toBe('domain(geosite:youtube) -> us')
    expect(lines[lines.length - 1]).toBe('fallback: proxy')
  })

  it('replaces an existing service line instead of duplicating it', () => {
    const source = `${BASE}\ndomain(geosite:youtube) -> proxy\n`
    const text = writeServiceRules(source, [
      { service: 'youtube', action: { kind: 'group', group: 'us' } },
    ])
    expect(text.match(/domain\(geosite:youtube\)/g)).toHaveLength(1)
    expect(text).toContain('domain(geosite:youtube) -> us')
    expect(text).not.toContain('domain(geosite:youtube) -> proxy')
  })

  it('drops a service when its action is removed', () => {
    const source = `${BASE}\ndomain(geosite:youtube) -> proxy\n`
    const text = writeServiceRules(source, [])
    expect(text).not.toContain('geosite:youtube')
    expect(text).toContain('fallback: proxy')
  })

  it('keeps hand written rules and comments in place', () => {
    const source = [
      '# 我自己的备注',
      'domain(suffix:internal.example) -> direct',
      'fallback: proxy',
      '',
    ].join('\n')
    const text = writeServiceRules(source, [
      { service: 'lan', action: { kind: 'direct' } },
    ])
    expect(text).toContain('# 我自己的备注')
    expect(text).toContain('domain(suffix:internal.example) -> direct')
    expect(text).toContain('dip(geoip:private) -> direct')
  })

  it('orders generated rules by the catalog, not by input order', () => {
    const text = writeServiceRules(BASE, [
      { service: 'lan', action: { kind: 'direct' } },
      { service: 'youtube', action: { kind: 'group', group: 'us' } },
    ])
    expect(text.indexOf('domain(geosite:youtube)')).toBeLessThan(text.indexOf('dip(geoip:private)'))
  })

  it('collapses repeated blank lines so saving twice does not grow the file', () => {
    const once = writeServiceRules(BASE, DEFAULT_SERVICE_RULES)
    const twice = writeServiceRules(once, DEFAULT_SERVICE_RULES)
    expect(twice).toBe(once)
    expect(once).not.toMatch(/\n{3,}/)
  })

  it('appends when the source has no fallback line', () => {
    const text = writeServiceRules('dip(geoip:cn) -> direct\n', [
      { service: 'ads', action: { kind: 'block' } },
    ])
    expect(text.trim().split('\n').at(-1)).toBe('domain(geosite:category-ads-all) -> block')
  })
})

describe('自定义规则', () => {
  it('geosite 分类写成 domain(geosite:...)', () => {
    expect(matcherOf('geosite', 'netflix')).toBe('domain(geosite:netflix)')
  })

  it('geoip 国家写成 dip(geoip:...)', () => {
    expect(matcherOf('geoip', 'jp')).toBe('dip(geoip:jp)')
  })

  it('自定义域名可以用后缀、关键字、完整域名三种写法', () => {
    expect(matcherOf('domain-suffix', 'example.com')).toBe('domain(suffix:example.com)')
    expect(matcherOf('domain-keyword', 'pt')).toBe('domain(keyword:pt)')
    expect(matcherOf('domain-full', 'a.example.com')).toBe('domain(full:a.example.com)')
  })

  it('空值不生成匹配器，避免写出 domain(suffix:)', () => {
    expect(matcherOf('domain-suffix', '   ')).toBe('')
  })

  it('认得出的匹配器能反解回结构', () => {
    expect(customRuleOf('domain(geosite:category-ads-all)', { kind: 'block' })).toEqual({
      kind: 'geosite',
      value: 'category-ads-all',
      action: { kind: 'block' },
    })
    expect(customRuleOf('l4proto(tcp) && dport(6881-6999)', { kind: 'direct' })).toEqual({
      kind: 'port',
      value: '6881-6999',
      action: { kind: 'direct' },
    })
  })

  it('复杂的组合匹配器不归向导管', () => {
    expect(customRuleOf('domain(suffix:a.com) && dport(443)', { kind: 'direct' })).toBeNull()
    expect(customRuleOf('pname(curl)', { kind: 'direct' })).toBeNull()
  })

  it('能读出配置里的自定义规则，并跳过服务预设', () => {
    const text = [
      'domain(geosite:netflix) -> proxy',
      'domain(suffix:pt.example) -> direct',
      'dip(geoip:jp) -> JP',
      'fallback: proxy',
    ].join('\n')
    expect(parseCustomRules(text)).toEqual([
      { kind: 'domain-suffix', value: 'pt.example', action: { kind: 'direct' } },
      { kind: 'geoip', value: 'jp', action: { kind: 'group', group: 'JP' } },
    ])
  })

  it('写回时自定义规则排在服务预设前面，手写规则与注释原样保留', () => {
    const text = [
      '# 我的备注',
      'pname(NetworkManager, systemd-resolved, dnsmasq) -> must_direct',
      'domain(suffix:old.example) -> proxy',
      'someCustomMatcher(1) -> direct',
      'fallback: proxy',
    ].join('\n')
    const out = writeRules(
      text,
      [{ service: 'netflix', action: { kind: 'group', group: 'proxy' } }],
      [{ kind: 'geosite', value: 'category-ads-all', action: { kind: 'block' } }],
    )
    const lines = out.trim().split('\n')
    expect(lines[0]).toBe('# 我的备注')
    expect(lines).toContain('domain(geosite:category-ads-all) -> block')
    expect(lines).toContain('domain(geosite:netflix) -> proxy')
    expect(lines).toContain('someCustomMatcher(1) -> direct')
    expect(lines.indexOf('domain(geosite:category-ads-all) -> block')).toBeLessThan(
      lines.indexOf('domain(geosite:netflix) -> proxy'),
    )
    expect(lines.indexOf('domain(geosite:netflix) -> proxy')).toBeLessThan(lines.indexOf('fallback: proxy'))
    expect(lines).not.toContain('domain(suffix:old.example) -> proxy')
  })

  it('重复的自定义规则只写一次', () => {
    const out = writeRules('fallback: proxy', [], [
      { kind: 'geoip', value: 'jp', action: { kind: 'direct' } },
      { kind: 'geoip', value: 'jp', action: { kind: 'block' } },
    ])
    expect(out.split('\n').filter((line) => line.includes('geoip:jp'))).toHaveLength(1)
  })
})

describe('geo 分类必须真实存在', () => {
  // 写一个不存在的 geosite/geoip 分类，dae 会放弃整张分流表：
  // ApplyRulesOptimizers error: code X not found。用户只会看到「分流全没了」，
  // 很难联想到是一个分类名写错。这里把目录里所有引用都钉在真实分类表上。
  const references = [
    ...ROUTING_SERVICES.map((service) => ({ where: service.id, matcher: service.matcher })),
  ]

  it.each(references)('$where 引用的分类都在 geosite.dat / geoip.dat 里', ({ matcher }) => {
    const geosite = [...matcher.matchAll(/geosite:([\w!-]+)/g)].map((item) => item[1])
    const geoip = [...matcher.matchAll(/geoip:([\w!-]+)/g)].map((item) => item[1])
    for (const code of geosite) {
      expect(hasGeoSite(code), `geosite:${code} 不存在`).toBe(true)
    }
    for (const code of geoip) {
      expect(hasGeoIP(code), `geoip:${code} 不存在`).toBe(true)
    }
  })
})
