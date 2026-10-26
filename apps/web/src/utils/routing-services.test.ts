import { describe, expect, it } from 'vitest'
import {
  actionEquals,
  actionTarget,
  DEFAULT_SERVICE_RULES,
  parseServiceRules,
  ROUTING_SERVICES,
  ruleLine,
  serviceById,
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
    expect(text.trim().split('\n').at(-1)).toBe('domain(geosite:ads) -> block')
  })
})
