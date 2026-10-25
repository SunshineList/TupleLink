import { describe, expect, it } from 'vitest'
import { insertRoutingRules, renderPreset, ROUTING_RULE_PRESETS } from './routing-presets'

const BASE = [
  'pname(NetworkManager, systemd-resolved, dnsmasq) -> must_direct',
  'dip(geoip:private) -> direct',
  'domain(geosite:cn) -> direct',
  'fallback: proxy',
].join('\n')

describe('routing rule presets', () => {
  it('规则插在 fallback 之前', () => {
    const { text, inserted } = insertRoutingRules(BASE, ['domain(geosite:netflix) -> proxy'])
    expect(inserted).toEqual(['domain(geosite:netflix) -> proxy'])
    const lines = text.split('\n')
    expect(lines.indexOf('domain(geosite:netflix) -> proxy')).toBe(3)
    expect(lines.at(-1)).toBe('fallback: proxy')
  })

  it('重复插入同一行不会让配置变脏', () => {
    const once = insertRoutingRules(BASE, ['domain(geosite:netflix) -> proxy'])
    const twice = insertRoutingRules(once.text, ['domain(geosite:netflix) -> proxy'])
    expect(twice.text).toBe(once.text)
    expect(twice.inserted).toEqual([])
    expect(twice.skipped).toEqual(['domain(geosite:netflix) -> proxy'])
  })

  it('已存在的行只跳过它自己，其余照插', () => {
    const result = insertRoutingRules(BASE, [
      'dip(geoip:private) -> direct',
      'domain(geosite:disney) -> proxy',
    ])
    expect(result.inserted).toEqual(['domain(geosite:disney) -> proxy'])
    expect(result.skipped).toEqual(['dip(geoip:private) -> direct'])
  })

  it('注释掉的行不算已存在', () => {
    const source = ['# domain(geosite:netflix) -> proxy', 'fallback: proxy'].join('\n')
    const { inserted } = insertRoutingRules(source, ['domain(geosite:netflix) -> proxy'])
    expect(inserted).toEqual(['domain(geosite:netflix) -> proxy'])
  })

  it('没有 fallback 时追加到末尾，并且不留空行', () => {
    const { text } = insertRoutingRules('dip(geoip:cn) -> direct\n\n', ['domain(geosite:ai) -> proxy'])
    expect(text).toBe('dip(geoip:cn) -> direct\ndomain(geosite:ai) -> proxy\n')
  })

  it('空配置也能插', () => {
    const { text } = insertRoutingRules('', ['domain(geosite:netflix) -> proxy'])
    expect(text).toBe('domain(geosite:netflix) -> proxy\n')
  })

  it('多条规则保持给定顺序', () => {
    const { text } = insertRoutingRules('fallback: proxy', ['a -> direct', 'b -> direct'])
    expect(text.split('\n')).toEqual(['a -> direct', 'b -> direct', 'fallback: proxy'])
  })
})

describe('render preset', () => {
  it('把群组名替换进模板', () => {
    const netflix = ROUTING_RULE_PRESETS.find((item) => item.id === 'netflix')!
    expect(renderPreset(netflix, 'proxy')).toEqual(['domain(geosite:netflix) -> proxy'])
  })

  it('没有群组时依赖群组的预设产出空数组', () => {
    const netflix = ROUTING_RULE_PRESETS.find((item) => item.id === 'netflix')!
    expect(renderPreset(netflix, '')).toEqual([])
  })

  it('不依赖群组的预设即使没有群组也能用', () => {
    const ads = ROUTING_RULE_PRESETS.find((item) => item.id === 'ad-block')!
    expect(renderPreset(ads, '')).toEqual(['domain(geosite:category-ads-all) -> must_direct'])
  })

  it('每条预设都至少有一行，并且都带 -> 目标', () => {
    for (const item of ROUTING_RULE_PRESETS) {
      expect(item.template.length).toBeGreaterThan(0)
      for (const line of item.template) {
        expect(line).toMatch(/->\s*\S+/)
      }
    }
  })
})
