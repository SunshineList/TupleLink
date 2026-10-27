import { describe, expect, it } from 'vitest'
import { checkWireGuard, findPrivateRule, isWireGuard, privateCidrOf, suggestPrivateReorder } from './wireguard-check'

const iface = (name: string, ip: string[] = []) => ({ name, ip })

describe('识别 wireguard 接口', () => {
  it('认得常见命名', () => {
    for (const name of ['wg0', 'wg1', 'wg-home', 'vpn_wg', 'my-wg0']) {
      expect(isWireGuard(name), name).toBe(true)
    }
  })

  it('不把普通接口误判成 wg', () => {
    // 这条最要紧：误报会让用户去改一个根本不存在的接口。
    for (const name of ['br-lan', 'wan', 'wan6', 'eth0', 'pppoe-wan', 'wlan0', 'wgtest']) {
      expect(isWireGuard(name), name).toBe(false)
    }
  })
})

describe('取私网网段', () => {
  it('只保留 RFC1918 地址', () => {
    const result = privateCidrOf(iface('wg0', ['10.8.0.1/24', '203.0.113.5/24', '172.20.0.1/16', '192.168.9.1/24']))
    expect(result).toEqual(['10.8.0.1/24', '172.20.0.1/16', '192.168.9.1/24'])
  })

  it('没有前缀的地址跳过', () => {
    expect(privateCidrOf(iface('wg0', ['10.8.0.1']))).toEqual([])
  })

  it('172.15 和 172.32 不算私网', () => {
    expect(privateCidrOf(iface('wg0', ['172.15.0.1/16', '172.32.0.1/16']))).toEqual([])
  })
})

describe('wireguard 绑定检查', () => {
  it('没装 WireGuard 时不出声', () => {
    const result = checkWireGuard([iface('br-lan', ['192.168.5.1/24']), iface('wan')], ['br-lan'])
    expect(result.message).toBe('')
    expect(result.uncovered).toEqual([])
  })

  it('wg0 不在 lan_interface 里时报警', () => {
    // 这就是「连上了但上不了外网」的根因：流量绕过 dae。
    const result = checkWireGuard([iface('br-lan', ['192.168.5.1/24']), iface('wg0', ['10.8.0.1/24'])], ['br-lan'])
    expect(result.message).toBe('wireguardNotBound')
    expect(result.uncovered).toEqual(['wg0'])
    expect(result.suggestion).toEqual(['wg0'])
  })

  it('wg0 已经绑好、但网段是私网时提示规则顺序', () => {
    const result = checkWireGuard(
      [iface('br-lan', ['192.168.5.1/24']), iface('wg0', ['10.8.0.1/24'])],
      ['br-lan', 'wg0'],
    )
    expect(result.message).toBe('wireguardPrivateRule')
    expect(result.uncovered).toEqual([])
    expect(result.privateCidrs).toEqual(['10.8.0.1/24'])
  })

  it('wg0 绑好且是公网网段时完全不出声', () => {
    const result = checkWireGuard([iface('wg0', ['203.0.113.5/24'])], ['br-lan', 'wg0'])
    expect(result.message).toBe('')
  })

  it('多个 wg 接口时只报没绑的那些', () => {
    const result = checkWireGuard([iface('wg0', ['10.8.0.1/24']), iface('wg1', ['10.9.0.1/24'])], ['br-lan', 'wg0'])
    expect(result.uncovered).toEqual(['wg1'])
    // wg0 已绑定，网段仍要提醒顺序。
    expect(result.privateCidrs).toEqual(['10.8.0.1/24'])
  })
})

describe('私网直连规则的顺序', () => {
  it('找到 default 分流表里的那一行', () => {
    const source = [
      'pname(NetworkManager, systemd-resolved, dnsmasq) -> must_direct',
      'dip(geoip:private) -> direct',
      'dip(geoip:cn) -> direct',
      'fallback: proxy',
    ].join('\n')
    const result = findPrivateRule(source)
    expect(result?.privateRuleLine).toBe(1)
    expect(result?.isDirect).toBe(true)
    expect(result?.hasEarlierWireGuardRule).toBe(false)
  })

  it('前面已经有 IP 规则时标记为已处理', () => {
    const source = ['dip(10.8.0.0/24) -> proxy', 'dip(geoip:private) -> direct', 'fallback: proxy'].join('\n')
    expect(findPrivateRule(source)?.hasEarlierWireGuardRule).toBe(true)
  })

  it('注释掉的行不算', () => {
    const source = ['# dip(geoip:private) -> direct', 'fallback: proxy'].join('\n')
    expect(findPrivateRule(source)).toBeNull()
  })

  it('must_direct 也算直连', () => {
    expect(findPrivateRule('dip(geoip:private) -> must_direct')?.isDirect).toBe(true)
  })

  it('没有这条规则时返回 null', () => {
    expect(findPrivateRule('fallback: proxy')).toBeNull()
  })
})

describe('生成重排建议', () => {
  const source = [
    'pname(NetworkManager) -> must_direct',
    'dip(geoip:private) -> direct',
    'dip(geoip:cn) -> direct',
    'fallback: proxy',
  ].join('\n')

  it('把网段规则插到私网直连之前', () => {
    const out = suggestPrivateReorder(source, '10.8.0.0/24', 'proxy')
    const lines = out.split('\n')
    expect(lines[1]).toBe('dip(10.8.0.0/24) -> proxy')
    expect(lines[2]).toBe('dip(geoip:private) -> direct')
  })

  it('没有私网规则时插到最前', () => {
    const out = suggestPrivateReorder('fallback: proxy', '10.8.0.0/24', 'proxy')
    expect(out.split('\n')[0]).toBe('dip(10.8.0.0/24) -> proxy')
  })

  it('不改动原有的其他行', () => {
    const out = suggestPrivateReorder(source, '10.8.0.0/24', 'proxy')
    expect(out).toContain('pname(NetworkManager) -> must_direct')
    expect(out).toContain('fallback: proxy')
    expect(out.split('\n')).toHaveLength(5)
  })
})
