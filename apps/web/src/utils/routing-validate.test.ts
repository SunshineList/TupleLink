import { describe, expect, it } from 'vitest'
import { describeInvalidCode, invalidCodes } from './routing-validate'

describe('分流表分类校验', () => {
  it('全部存在时不报任何问题', () => {
    expect(invalidCodes('domain(geosite:youtube) -> proxy\ndip(geoip:cn) -> direct')).toEqual([])
  })

  it('抓到不存在的分类', () => {
    expect(invalidCodes('domain(geosite:ads) -> block')).toEqual([{ kind: 'geosite', code: 'ads' }])
    expect(invalidCodes('dip(geoip:mars) -> direct')).toEqual([{ kind: 'geoip', code: 'mars' }])
  })

  it('大小写不敏感，且同样名字只报一次', () => {
    const text = [
      'domain(geosite:ADS) -> block',
      'domain(geosite:ads) -> proxy',
      'domain(GEOSITE:Ads) -> direct',
    ].join('\n')
    expect(invalidCodes(text)).toHaveLength(1)
  })

  it('合法分类在混合文本里不被误报', () => {
    const text = [
      'pname(NetworkManager, systemd-resolved, dnsmasq) -> must_direct',
      'domain(geosite:category-ads-all) -> block',
      'domain(geosite:cn) -> direct',
      'domain(geosite:geolocation-!cn) -> proxy',
      'fallback: proxy',
    ].join('\n')
    expect(invalidCodes(text)).toEqual([])
  })

  it('描述成 geosite:x 的形式方便直接指出问题', () => {
    expect(describeInvalidCode({ kind: 'geosite', code: 'ads' })).toBe('geosite:ads')
  })
})
