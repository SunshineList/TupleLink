import { describe, expect, it } from 'vitest'
import { actionOfTarget, evaluateRule, normalizeDomain, parseRuleLines, testRouting } from './routing-tester'

const DEFAULT_ROUTING = [
  'pname(NetworkManager, systemd-resolved, dnsmasq) -> must_direct',
  'dip(geoip:private) -> direct',
  'dip(geoip:cn) -> direct',
  'domain(geosite:cn) -> direct',
  'fallback: proxy',
].join('\n')

describe('域名规范化', () => {
  it('去协议、路径、端口', () => {
    expect(normalizeDomain('https://www.youtube.com/watch?v=1')).toBe('www.youtube.com')
    expect(normalizeDomain('www.youtube.com:443')).toBe('www.youtube.com')
  })

  it('去掉 userinfo', () => {
    expect(normalizeDomain('https://user:pass@example.com/x')).toBe('example.com')
  })

  it('转小写', () => {
    expect(normalizeDomain('WWW.Example.COM')).toBe('www.example.com')
  })

  it('接受裸 IP', () => {
    expect(normalizeDomain('1.1.1.1')).toBe('1.1.1.1')
  })

  it('拒绝空值和非法字符', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('exa mple.com')).toBeNull()
  })

  it('拒绝没有点的主机名', () => {
    // 单标签主机名（localhost、内网名）不是公网域名，分流规则也匹配不到。
    expect(normalizeDomain('localhost')).toBeNull()
  })
})

describe('解析规则文本', () => {
  it('保留行号，注释不参与匹配', () => {
    const lines = parseRuleLines('# 备注\ndomain(suffix:a.com) -> proxy\n\nfallback: direct')
    expect(lines[0].isComment).toBe(true)
    expect(lines[1].line).toBe(2)
    expect(lines[1].matcher).toBe('domain(suffix:a.com)')
    expect(lines[3].isFallback).toBe(true)
  })

  it('认出行尾注释', () => {
    const lines = parseRuleLines('domain(suffix:a.com) -> proxy  # 我的备注')
    expect(lines[0].target).toBe('proxy')
  })

  it('没有箭头的行当成注释，不参与匹配但不丢弃', () => {
    const lines = parseRuleLines('这一行没有箭头')
    expect(lines).toHaveLength(1)
    expect(lines[0].isComment).toBe(true)
  })
})

describe('单条规则判定', () => {
  const rule = (matcher: string, target = 'proxy') => ({
    raw: `${matcher} -> ${target}`,
    line: 1,
    matcher,
    target,
    isFallback: false,
    isComment: false,
  })

  it('suffix 匹配子域与自身', () => {
    expect(evaluateRule(rule('domain(suffix:youtube.com)'), 'youtube.com', null).verdict).toBe('match')
    expect(evaluateRule(rule('domain(suffix:youtube.com)'), 'www.youtube.com', null).verdict).toBe('match')
    expect(evaluateRule(rule('domain(suffix:youtube.com)'), 'notyoutube.com', null).verdict).toBe('no-match')
  })

  it('suffix 不做前缀匹配', () => {
    // suffix:youtube.com 不该命中 youtube.com.evil.net —— 那是另一个域。
    expect(evaluateRule(rule('domain(suffix:youtube.com)'), 'youtube.com.evil.net', null).verdict).toBe('no-match')
  })

  it('full 要求完全相等', () => {
    expect(evaluateRule(rule('domain(full:a.com)'), 'a.com', null).verdict).toBe('match')
    expect(evaluateRule(rule('domain(full:a.com)'), 'x.a.com', null).verdict).toBe('no-match')
  })

  it('keyword 是子串匹配', () => {
    expect(evaluateRule(rule('domain(keyword:google)'), 'www.google.com', null).verdict).toBe('match')
    expect(evaluateRule(rule('domain(keyword:google)'), 'example.com', null).verdict).toBe('no-match')
  })

  it('多个值逗号分隔，任一命中即可', () => {
    expect(evaluateRule(rule('domain(suffix:a.com,b.com)'), 'b.com', null).verdict).toBe('match')
  })

  it('geosite 分类现在能真的判定', () => {
    // 域清单已经从 geosite.dat 解析进来（见 geosite-domains.ts）。
    expect(evaluateRule(rule('domain(geosite:youtube)'), 'youtube.com', null).verdict).toBe('match')
    expect(evaluateRule(rule('domain(geosite:youtube)'), 'www.youtube.com', null).verdict).toBe('match')
    expect(evaluateRule(rule('domain(geosite:youtube)'), 'example.com', null).verdict).toBe('no-match')
  })

  it('geosite 分类名大小写不敏感', () => {
    expect(evaluateRule(rule('domain(geosite:YouTube)'), 'youtube.com', null).verdict).toBe('match')
  })

  it('不在裁剪名单里的分类仍标 unknown', () => {
    // 数据边界：只保留了 16 个常用分类，其余（尤其 geoip 国家段）判不了。
    const result = evaluateRule(rule('domain(geosite:somethingelse)'), 'a.com', null)
    expect(result.verdict).toBe('unknown')
    expect(result.reason).toBe('geosite-missing')
  })

  it('geoip 同样判不了', () => {
    expect(evaluateRule(rule('dip(geoip:cn)'), '1.1.1.1', null).verdict).toBe('unknown')
  })

  it('iP 规则对域名是确定的 no-match', () => {
    // 域名不会命中 IP 段，这一点不需要 geoip 数据也能确定。
    expect(evaluateRule(rule('dip(1.1.1.1)'), 'example.com', null).verdict).toBe('no-match')
  })

  it('cIDR 覆盖判断正确', () => {
    expect(evaluateRule(rule('dip(192.168.0.0/16)'), '192.168.5.3', null).verdict).toBe('match')
    expect(evaluateRule(rule('dip(192.168.0.0/16)'), '192.169.0.1', null).verdict).toBe('no-match')
  })

  it('&& 组合里任一条不命中就整体不命中', () => {
    expect(evaluateRule(rule('dip(1.1.1.1) && domain(suffix:a.com)'), 'a.com', null).verdict).toBe('no-match')
  })

  it('&& 里有判不了的子句时整体 unknown', () => {
    expect(evaluateRule(rule('domain(suffix:a.com) && dip(geoip:cn)'), 'a.com', null).verdict).toBe('unknown')
  })

  it('port 规则要用户给端口才判得了', () => {
    expect(evaluateRule(rule('dport(443)'), 'a.com', null).verdict).toBe('unknown')
    expect(evaluateRule(rule('dport(443)'), 'a.com', 443).verdict).toBe('match')
    expect(evaluateRule(rule('dport(443)'), 'a.com', 80).verdict).toBe('no-match')
  })

  it('端口区间', () => {
    expect(evaluateRule(rule('dport(1000-2000)'), 'a.com', 1500).verdict).toBe('match')
    expect(evaluateRule(rule('dport(1000-2000)'), 'a.com', 2001).verdict).toBe('no-match')
  })

  it('pname 这类与域名无关的判不了', () => {
    expect(evaluateRule(rule('pname(dnsmasq)'), 'a.com', null).verdict).toBe('unknown')
  })
})

describe('目标动作分类', () => {
  it('direct 与 must_direct 都算直连', () => {
    expect(actionOfTarget('direct')).toBe('direct')
    expect(actionOfTarget('must_direct')).toBe('direct')
  })

  it('block 是阻断，其他名字都是群组', () => {
    expect(actionOfTarget('block')).toBe('block')
    expect(actionOfTarget('proxy')).toBe('proxy')
    expect(actionOfTarget('AI')).toBe('proxy')
  })
})

describe('完整测试', () => {
  it('命中自定义规则并标出被遮蔽的行', () => {
    const source = [
      'domain(suffix:google.com) -> AI',
      'domain(suffix:maps.google.com) -> direct',
      'fallback: proxy',
    ].join('\n')
    // maps.google.com 本该走 direct，但上面那条先命中了 —— 这正是最常见的坑。
    const result = testRouting(source, 'maps.google.com')
    expect(result.hit?.line).toBe(1)
    expect(result.action).toBe('proxy')
    expect(result.hit?.target).toBe('AI')
    expect(result.shadowed).toContain(2)
  })

  it('前面的规则判不了时继续往下找', () => {
    // geosite:cn 不在裁剪名单里（11 万条，体积不成比例），所以判不了。
    // 判不了不等于不命中，要继续往下走到 fallback。
    const result = testRouting(DEFAULT_ROUTING, 'youtube.com')
    expect(result.hit?.isFallback).toBe(true)
    expect(result.action).toBe('proxy')
  })

  it('命中直连规则', () => {
    const source = 'domain(suffix:cn) -> direct\nfallback: proxy'
    expect(testRouting(source, 'www.cn').action).toBe('direct')
  })

  it('命中阻断规则', () => {
    const source = 'domain(suffix:ads.com) -> block\nfallback: proxy'
    expect(testRouting(source, 'x.ads.com').action).toBe('block')
  })

  it('没有 fallback 且都不命中时去向为空', () => {
    const result = testRouting('domain(suffix:a.com) -> proxy', 'b.com')
    expect(result.hit).toBeNull()
    expect(result.action).toBe('none')
  })

  it('空规则表报错，而不是静默返回没命中', () => {
    expect(testRouting('# 只有注释', 'a.com').error).toBe('empty-routing')
  })

  it('非法输入报错', () => {
    expect(testRouting(DEFAULT_ROUTING, 'not a domain').error).toBe('invalid-domain')
  })

  it('评估结果保留所有行，便于展示推理过程', () => {
    const result = testRouting(DEFAULT_ROUTING, 'example.com')
    expect(result.evaluations.length).toBe(5)
    expect(result.evaluations[0].verdict).toBe('unknown')
  })

  it('端口参与判定', () => {
    const source = 'l4proto(tcp) && dport(443) -> proxy\nfallback: direct'
    expect(testRouting(source, 'a.com', '443').action).toBe('proxy')
    expect(testRouting(source, 'a.com', '80').action).toBe('direct')
  })
})
