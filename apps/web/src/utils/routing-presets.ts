// 常见分流规则：评论里「想给 Netflix / 广告 / 国内网站各配一条」被反复问到，
// 而 routingA 的写法对没读过文档的人门槛很高（fallback 必须最后一行、
// 匹配器写成 qname/domain/dip、目标要么是群组名要么是 must_direct）。
//
// 这里只负责「往现有配置里加一条正确的规则」，不替换、不重排用户的配置。
// 所有规则都插在第一条 fallback 之前，因为 fallback 之后的行不会被执行。

export type RoutingRuleId =
  | 'ad-block'
  | 'netflix'
  | 'disney'
  | 'youtube'
  | 'telegram'
  | 'ai'
  | 'cn-direct'
  | 'lan-direct'
  | 'game-udp'

export interface RoutingRulePreset {
  id: RoutingRuleId
  /** 插进配置的行；proxyTarget 由调用方按当前群组名替换。 */
  template: string[]
  needsProxyGroup: boolean
}

const preset = (id: RoutingRuleId, template: string[], needsProxyGroup = true): RoutingRulePreset => ({
  id,
  template,
  needsProxyGroup,
})

export const ROUTING_RULE_PRESETS: RoutingRulePreset[] = [
  // 广告域名走拒绝，比直接 direct 更省事：dae 会把域名解析成黑洞地址。
  preset('ad-block', ['domain(geosite:ads) -> must_direct'], false),
  preset('netflix', ['domain(geosite:netflix) -> {{proxy}}']),
  preset('disney', ['domain(suffix:disneyplus.com, suffix:dssott.com, suffix:bamgrid.com) -> {{proxy}}']),
  preset('youtube', ['domain(geosite:youtube) -> {{proxy}}']),
  preset('telegram', ['dip(geoip:telegram) -> {{proxy}}']),
  preset('ai', ['domain(suffix:openai.com, suffix:chatgpt.com, suffix:anthropic.com, suffix:claude.ai) -> {{proxy}}']),
  preset('cn-direct', ['domain(geosite:cn) -> direct'], false),
  preset('lan-direct', ['dip(geoip:private) -> direct'], false),
  // 游戏联机大多走 UDP，UDP 经过代理会掉线；这条放在最前面才有意义。
  preset('game-udp', ['l4proto(udp) && dport(1000-65535) -> direct'], false),
]

const FALLBACK = /^\s*fallback\s*:/

export interface InsertResult {
  text: string
  /** 实际插入的行；已经存在的规则不会重复插入。 */
  inserted: string[]
  /** 因为已存在而跳过的行。 */
  skipped: string[]
}

/**
 * 把预设规则插到第一条 fallback 之前。
 *
 * 幂等：已经出现过的行不会重复插入，所以连点两次不会让配置变脏。
 * 没有 fallback 时追加到末尾——那种配置本身就不完整，但至少不会更坏。
 */
export function insertRoutingRules(source: string, lines: string[]): InsertResult {
  const existing = new Set(
    source
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean),
  )
  const inserted: string[] = []
  const skipped: string[] = []
  for (const line of lines) {
    const rule = line.trim()
    if (!rule) continue
    if (existing.has(rule)) {
      skipped.push(rule)
      continue
    }
    existing.add(rule)
    inserted.push(rule)
  }
  if (!inserted.length) {
    return { text: source, inserted, skipped }
  }
  const all = source.split('\n')
  const index = all.findIndex((line) => FALLBACK.test(line))
  const block = inserted.map((line) => line)
  if (index < 0) {
    const trimmed = source.replace(/\s+$/, '')
    return { text: `${(trimmed ? `${trimmed  }\n` : '') + block.join('\n')  }\n`, inserted, skipped }
  }
  all.splice(index, 0, ...block)
  return { text: all.join('\n'), inserted, skipped }
}

/** 把模板里的 {{proxy}} 换成当前群组名；没有群组时返回空数组让调用方禁用该预设。 */
export function renderPreset(preset: RoutingRulePreset, proxyGroup: string): string[] {
  if (!preset.needsProxyGroup) return [...preset.template]
  if (!proxyGroup) return []
  return preset.template.map((line) => line.replaceAll('{{proxy}}', proxyGroup))
}
