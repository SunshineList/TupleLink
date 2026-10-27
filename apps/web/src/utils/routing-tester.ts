/**
 * 分流规则测试器：输入一个域名，看它会命中哪条规则、走哪个出口。
 *
 * 为什么需要：配了一条规则、访问网站却不生效，现在唯一的办法是真去访问
 * 一次再翻日志。而常见的原因是「规则本身没问题，只是被前面的规则挡住了」
 * ——这在保存时完全查不出来。
 *
 * ## 一个必须说清楚的能力边界
 *
 * 判断 `domain(geosite:youtube)` 是否匹配 `youtube.com`，需要该分类的
 * 域名清单。这份清单从 geosite.dat 解析后裁剪到 16 个常用分类（见
 * geosite-domains.ts），覆盖向导里可选的全部服务。
 *
 * 仍然判不了的情况（不在裁剪名单里的分类、geoip 国家段），必须如实标成
 * 「无法判定」，绝不能猜「不匹配」：那会让用户以为规则白写了，
 * 去删一条其实有效的规则。
 */

import { GEOSITE_DOMAINS } from './geosite-domains'

export type MatchVerdict = 'match' | 'no-match' | 'unknown'

export interface RuleLine {
  /** 原文，用于回显。 */
  raw: string
  /** 1 基行号，方便用户对着编辑器找。 */
  line: number
  /** 匹配器部分（箭头左边）。 */
  matcher: string
  /** 目标部分（箭头右边）。 */
  target: string
  /** 是否是 fallback 行。 */
  isFallback: boolean
  /** 是否是注释或空行。 */
  isComment: boolean
}

export interface RuleEvaluation extends RuleLine {
  verdict: MatchVerdict
  /** 判定依据，给人看的。 */
  reason: string
}

export interface RoutingTestResult {
  /** 命中的第一条规则；null 表示一条都没命中。 */
  hit: RuleEvaluation | null
  /** 按顺序的全部评估结果，用来展示「为什么是这条」。 */
  evaluations: RuleEvaluation[]
  /** 输入本身是否合法。 */
  error?: 'invalid-domain' | 'empty-routing'
  /** 该出口是走代理、直连还是阻断。 */
  action: 'proxy' | 'direct' | 'block' | 'none'
  /** 命中后不会执行的规则行号（被遮蔽）。 */
  shadowed: number[]
}

const ARROW = /\s*->\s*/

/** 把 routingA 文本拆成结构化行，保留行号与注释状态。 */
export function parseRuleLines(source: string): RuleLine[] {
  const lines: RuleLine[] = []
  source.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim()
    const line = index + 1
    if (!trimmed) {
      lines.push({ raw, line, matcher: '', target: '', isFallback: false, isComment: false })
      return
    }
    // 整行注释：记下来但不参与匹配，展示时仍要能看到。
    if (trimmed.startsWith('#')) {
      lines.push({ raw, line, matcher: '', target: '', isFallback: false, isComment: true })
      return
    }
    const body = trimmed.replace(/#.*$/, '').trim()
    // 不用正则拆 fallback：`\s*` 与 `.+` 相邻会触发回溯警告，
    // 而这里其实只是「以 fallback: 开头」。startsWith + slice 更直白。
    if (/^fallback\b/i.test(body)) {
      const colon = body.indexOf(':')
      const target = colon >= 0 ? body.slice(colon + 1).trim() : ''
      if (target) {
        lines.push({ raw, line, matcher: 'fallback', target, isFallback: true, isComment: false })
        return
      }
    }
    const parts = body.split(ARROW)
    if (parts.length !== 2) {
      // 认不出的行原样保留，标成注释类：不参与匹配，但不能藏起来。
      lines.push({ raw, line, matcher: '', target: '', isFallback: false, isComment: true })
      return
    }
    lines.push({
      raw,
      line,
      matcher: parts[0].trim(),
      target: parts[1].trim(),
      isFallback: false,
      isComment: false,
    })
  })
  return lines
}

/** 输入校验与规范化。 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase()
  if (!value) return null
  // 允许用户粘贴整条 URL：取出主机名就够，端口和路径对分流无影响。
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.split('/')[0]
  value = value.split('?')[0]
  value = value.split('#')[0]
  // 去掉 userinfo 和端口。
  value = value.replace(/^[^@]*@/, '')
  value = value.replace(/:\d+$/, '')
  if (!value) return null
  if (value.length > 253) return null
  // 域名或 IP 都接受，逐段校验。
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) return null
  return value
}

function isIPv4(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
}

/** 判断 domain 是否命中 suffix/full/keyword 三种写法。 */
function matchDomainClause(domain: string, clause: string): boolean {
  const suffix = /^suffix:(.+)$/i.exec(clause)
  if (suffix) {
    const want = suffix[1].toLowerCase().replace(/^\./, '')
    // suffix 匹配域名本身及其子域，与 dae 语义一致。
    return domain === want || domain.endsWith(`.${want}`)
  }
  const full = /^full:(.+)$/i.exec(clause)
  if (full) return domain === full[1].toLowerCase()
  const keyword = /^keyword:(.+)$/i.exec(clause)
  if (keyword) return domain.includes(keyword[1].toLowerCase())
  // 裸域名写法 domain(example.com) 在 dae 里等价于 full。
  return domain === clause.toLowerCase()
}

/** CIDR 是否包含给定 IPv4。 */
function inCidr(ip: string, cidr: string): boolean | null {
  const [base, bitsText] = cidr.split('/')
  if (!isIPv4(base) || !isIPv4(ip)) return null
  const bits = bitsText === undefined ? 32 : Number(bitsText)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null
  const toInt = (value: string) => value.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
  // 32 位全 1 左移到前缀长度：bits=0 时高位溢出，单独处理。
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return (toInt(ip) & mask) === (toInt(base) & mask)
}

/**
 * 评估单条规则。
 *
 * `domain` 已规范化。返回 unknown 时 reason 会说明为什么判不了，
 * 让用户知道是「工具能力有限」而不是「规则写错了」。
 */
export function evaluateRule(
  rule: RuleLine,
  domain: string,
  port: number | null,
): { verdict: MatchVerdict; reason: string } {
  if (rule.isComment) return { verdict: 'unknown', reason: 'comment' }
  if (rule.isFallback) return { verdict: 'match', reason: 'fallback' }

  const matcher = rule.matcher
  const clauses = matcher.split('&&').map((item) => item.trim())
  let sawUnknown = false
  let unknownReason = 'geosite'

  for (const clause of clauses) {
    const result = evaluateClause(clause, domain, port)
    if (result.verdict === 'no-match') return result
    if (result.verdict === 'unknown' && !sawUnknown) {
      sawUnknown = true
      // 保留第一条 unknown 子句的真实原因，别一律报成 geosite：
      // 「分类不在数据里」和「port 没填」对用户是两件不同的事。
      unknownReason = result.reason
    }
  }
  if (sawUnknown) return { verdict: 'unknown', reason: unknownReason }
  return { verdict: 'match', reason: 'matched' }
}

/**
 * 判断域名是否属于某个 geosite 分类。
 *
 * 分类名大小写不敏感（dae 加载时会统一转大写）。不在裁剪名单里的分类
 * 返回 unknown——那是工具的数据边界，不是规则错误。
 *
 * suffix 型按「等于该域名或以 .该域名 结尾」判断，与 dae 语义一致：
 * suffix:google.com 命中 google.com 和 mail.google.com，但不命中 notgoogle.com。
 */
function matchGeosite(code: string, domain: string): { verdict: MatchVerdict; reason: string } {
  const entry = GEOSITE_DOMAINS[code.toUpperCase()]
  if (!entry) {
    // 数据里没有这个分类：地理分类、广告列表或用户自建的。
    return { verdict: 'unknown', reason: 'geosite-missing' }
  }
  for (const suffix of entry.s) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) {
      return { verdict: 'match', reason: 'geosite' }
    }
  }
  for (const full of entry.f) {
    if (domain === full) return { verdict: 'match', reason: 'geosite' }
  }
  // 清单来自 geosite.dat，完整的，所以不在里面就是确定不命中。
  return { verdict: 'no-match', reason: 'geosite' }
}

function evaluateClause(
  clause: string,
  domain: string,
  port: number | null,
): { verdict: MatchVerdict; reason: string } {
  // domain(...) / qname(...)：括号里可能是 suffix/full/keyword/geosite 或裸域名。
  const domainCall = /^(?:domain|qname)\((.*)\)$/i.exec(clause)
  if (domainCall) {
    const inner = domainCall[1].trim()
    if (/^geosite:/i.test(inner)) {
      return matchGeosite(inner.replace(/^geosite:/i, ''), domain)
    }
    // 多个值用逗号分隔，任一命中即可。
    const items = inner
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const hit = items.some((item) => matchDomainClause(domain, item))
    return hit ? { verdict: 'match', reason: 'domain' } : { verdict: 'no-match', reason: 'domain' }
  }

  // dip(...)：IP 或 CIDR。域名输入时只能判「不是 IP」。
  const dipCall = /^dip\((.*)\)$/i.exec(clause)
  if (dipCall) {
    const inner = dipCall[1].trim()
    if (/^geoip:/i.test(inner)) {
      // 国家/地区段需要 geoip.dat，同样判不了。
      return { verdict: 'unknown', reason: 'geoip' }
    }
    if (!isIPv4(domain)) {
      // 域名不会命中 IP 规则，这是确定的。
      return { verdict: 'no-match', reason: 'ip' }
    }
    const items = inner
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    for (const item of items) {
      const result = inCidr(domain, item)
      if (result === true) return { verdict: 'match', reason: 'ip' }
      if (result === null) return { verdict: 'unknown', reason: 'ip' }
    }
    return { verdict: 'no-match', reason: 'ip' }
  }

  // dport(...)：只有用户给了端口才判得了。
  const dport = /^dport\((.+)\)$/i.exec(clause)
  if (dport) {
    if (port === null) return { verdict: 'unknown', reason: 'port' }
    const spec = dport[1].trim()
    const single = Number(spec)
    if (Number.isInteger(single))
      return port === single ? { verdict: 'match', reason: 'port' } : { verdict: 'no-match', reason: 'port' }
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(spec)
    if (range) {
      const [low, high] = [Number(range[1]), Number(range[2])]
      return port >= low && port <= high
        ? { verdict: 'match', reason: 'port' }
        : { verdict: 'no-match', reason: 'port' }
    }
    return { verdict: 'unknown', reason: 'port' }
  }

  // l4proto：测试器模拟的是「浏览器访问一个站点」，天然是 TCP。
  // 所以 tcp 视为匹配、udp 视为不匹配 —— 这比标成「判不了」更有用，
  // 否则 `l4proto(tcp) && dport(443)` 这类常见写法整条都被判 unknown。
  const l4proto = /^l4proto\((.+)\)$/i.exec(clause)
  if (l4proto) {
    const values = l4proto[1].split(',').map((item) => item.trim().toLowerCase())
    if (values.includes('tcp')) return { verdict: 'match', reason: 'l4proto' }
    if (values.includes('udp')) return { verdict: 'no-match', reason: 'l4proto' }
    return { verdict: 'unknown', reason: 'other' }
  }

  // pname / mac / sip / sport：与目标域名无关，无法用域名判定。
  if (/^(?:pname|mac|sip|sport)\(/i.test(clause)) {
    return { verdict: 'unknown', reason: 'other' }
  }

  return { verdict: 'unknown', reason: 'other' }
}

/** 目标动作分类。 */
export function actionOfTarget(target: string): RoutingTestResult['action'] {
  const value = target.trim().toLowerCase()
  if (value === 'direct' || value === 'must_direct') return 'direct'
  if (value === 'block') return 'block'
  if (!value) return 'none'
  return 'proxy'
}

/**
 * 跑一次测试。
 *
 * 语义与 dae 一致：**第一条命中的规则决定去向**，fallback 兜底。
 * 命中之后的所有规则都不会执行，这些行号会被标成 shadowed，
 * 这正是用户最需要看到的信息——「我写的规则为什么不生效」。
 */
export function testRouting(source: string, input: string, portText = ''): RoutingTestResult {
  const lines = parseRuleLines(source)
  const meaningful = lines.filter((line) => !line.isComment && (line.matcher || line.isFallback))
  if (meaningful.length === 0) {
    return { hit: null, evaluations: [], error: 'empty-routing', action: 'none', shadowed: [] }
  }

  const domain = normalizeDomain(input)
  if (!domain) {
    return { hit: null, evaluations: [], error: 'invalid-domain', action: 'none', shadowed: [] }
  }
  const port = /^\d+$/.test(portText.trim()) ? Number(portText.trim()) : null

  const evaluations: RuleEvaluation[] = []
  let hit: RuleEvaluation | null = null

  for (const rule of lines) {
    if (rule.isComment && !rule.matcher && !rule.isFallback) continue
    const { verdict, reason } = evaluateRule(rule, domain, port)
    const evaluation: RuleEvaluation = { ...rule, verdict, reason }
    evaluations.push(evaluation)
    if (!hit && verdict === 'match') hit = evaluation
  }

  // 命中行之后、且本身可判定的规则，都不会再被执行 —— 标出来。
  const shadowed: number[] = []
  if (hit) {
    const hitIndex = evaluations.findIndex((item) => item.line === hit!.line)
    for (const item of evaluations.slice(hitIndex + 1)) {
      if (!item.isComment && item.verdict !== 'unknown') shadowed.push(item.line)
    }
  }

  return {
    hit,
    evaluations,
    action: hit ? actionOfTarget(hit.target) : 'none',
    shadowed,
  }
}
