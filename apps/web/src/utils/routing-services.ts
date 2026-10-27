// 分流「服务」目录：把「我想让这个服务走哪个节点」变成一行合法的 routingA。
//
// 分类名由 geosite.dat 提供，不同发行版（v2fly / Loyalsoldier / 自建）名字不一样，
// 写错一个分类会让整张分流表加载失败：dae-core 的 DatReaderOptimizer.Optimize
// 一次吃整张规则表，任一 loadGeoSite 出错就整体返回错误，用户看到的是「所有分流突然失效」。
//
// 所以本文件引用的每个分类名都必须能在 geodata-codes.ts 的白名单里查到：
//   - ROUTING_SERVICES 用到的分类全部实测存在；
//   - GEOSITE_HINTS 是自定义规则的输入提示，同样只列存在的名字，
//     否则用户点一下就会生成一条必炸的规则。
//
// 新增分类的规矩：先确认它在本机 geosite.dat / geoip.dat 里存在再加，
// 拿不准就用 domain(suffix:...) / domain(full:...)，域名不依赖数据文件。

import { hasGeoIP, hasGeoSite } from './geodata-codes'

export interface ServiceLabel {
  en: string
  'zh-Hans': string
}

export type ServiceId =
  | 'youtube'
  | 'netflix'
  | 'disney'
  | 'spotify'
  | 'tiktok'
  | 'telegram'
  | 'twitter'
  | 'github'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'microsoft'
  | 'apple'
  | 'amazon'
  | 'steam'
  | 'epic'
  | 'cn'
  | 'ads'
  | 'lan'
  | 'pt'
  | 'game-udp'

export interface RoutingService {
  id: ServiceId
  /** 列表里的短标签，避免为每个服务引入一个图标组件。 */
  badge: string
  /**
   * 显示名放在代码里而不是语言包：这些都是品牌名，中英写法基本一致，
   * 而语言包每多一个键都会让 t() 的返回类型变宽，触发 TS2589。
   */
  label: ServiceLabel
  /** 写进配置的匹配器，不含箭头。 */
  matcher: string
  /** 默认动作：true 表示默认走代理群组。 */
  proxyByDefault: boolean
}

const service = (
  id: ServiceId,
  badge: string,
  en: string,
  matcher: string,
  proxyByDefault = true,
  zh: string = en,
): RoutingService => ({ id, badge, label: { en, 'zh-Hans': zh }, matcher, proxyByDefault })

export const ROUTING_SERVICES: RoutingService[] = [
  service('youtube', 'YT', 'YouTube', 'domain(geosite:youtube)'),
  service('netflix', 'NF', 'Netflix', 'domain(geosite:netflix)'),
  service('disney', 'D+', 'Disney+', 'domain(geosite:disney)'),
  service('spotify', 'SP', 'Spotify', 'domain(geosite:spotify)'),
  service('tiktok', 'TT', 'TikTok', 'domain(geosite:tiktok)'),
  service('telegram', 'TG', 'Telegram', 'domain(geosite:telegram) || dip(geoip:telegram)'),
  service('twitter', 'X', 'X (Twitter)', 'domain(geosite:twitter)', true, 'X（推特）'),
  service('github', 'GH', 'GitHub', 'domain(geosite:github)'),
  service('openai', 'AI', 'OpenAI / ChatGPT', 'domain(geosite:openai)'),
  service('anthropic', 'AN', 'Claude', 'domain(geosite:anthropic)'),
  service('google', 'G', 'Google', 'domain(geosite:google)'),
  service('microsoft', 'MS', 'Microsoft', 'domain(geosite:microsoft)', true, '微软'),
  service('apple', 'AP', 'Apple', 'domain(geosite:apple)', true, '苹果'),
  service('amazon', 'AZ', 'Amazon', 'domain(geosite:amazon)', true, '亚马逊'),
  service('steam', 'ST', 'Steam', 'domain(geosite:steam)'),
  service('epic', 'EP', 'Epic Games', 'domain(geosite:epicgames)', true, 'Epic 游戏'),
  service('cn', 'CN', 'China mainland', 'domain(geosite:cn)', false, '中国大陆'),
  service('ads', 'AD', 'Ads', 'domain(geosite:category-ads-all)', false, '广告域名'),
  service('lan', 'LAN', 'Home network', 'dip(geoip:private)', false, '家庭内网'),
  // PT 站是私有 tracker（要邀请才能进），域名每家不同，向导里没法列举。
  // 按 BT 常用端口放行，比按域名猜更不容易误伤。
  service('pt', 'PT', 'Private tracker (PT)', 'l4proto(tcp) && dport(6881-6999)', false, 'PT 站'),
  // 联机游戏大量走 UDP，经过代理会掉线；这条要排在所有代理规则之前才有意义。
  service('game-udp', 'UDP', 'Game UDP', 'l4proto(udp) && dport(1000-65535)', false, '游戏 UDP'),
]

export const ROUTING_SERVICE_IDS = new Set<ServiceId>(ROUTING_SERVICES.map((item) => item.id))

export function serviceById(id: ServiceId): RoutingService | undefined {
  return ROUTING_SERVICES.find((item) => item.id === id)
}

/** 按 i18next 的语言码取显示名；除 zh 系以外一律用英文。 */
export function serviceLabel(id: ServiceId, language: string): string {
  const found = serviceById(id)
  if (!found) return id
  return language.startsWith('zh') ? found.label['zh-Hans'] : found.label.en
}

/** 目标动作：走某个群组，或者直连/阻断。 */
export type RoutingAction = { kind: 'group'; group: string } | { kind: 'direct' } | { kind: 'block' }

export function actionTarget(action: RoutingAction): string {
  if (action.kind === 'group') return action.group
  if (action.kind === 'block') return 'block'
  return 'direct'
}

export function actionEquals(a: RoutingAction | undefined, b: RoutingAction): boolean {
  if (!a) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'group' && b.kind === 'group') return a.group === b.group
  return true
}

/** 一行 `matcher -> target`，箭头两侧各留一个空格，与官方示例一致。 */
export function ruleLine(matcher: string, target: string): string {
  return `${matcher} -> ${target}`
}

export interface ServiceRule {
  service: ServiceId
  action: RoutingAction
}

const ARROW = /\s*->\s*/

/**
 * 从 routingA 文本里认出「服务 -> 动作」的映射。
 *
 * 只认匹配器与 ROUTING_SERVICES 完全一致的行；认不出的行留给高级编辑器，
 * 这里绝不改写它们——用户手写的规则比向导更重要。
 */
export function parseServiceRules(source: string): Map<ServiceId, RoutingAction> {
  const matcherToService = new Map<string, ServiceId>()
  for (const item of ROUTING_SERVICES) matcherToService.set(item.matcher, item.id)

  const result = new Map<ServiceId, RoutingAction>()
  for (const raw of source.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line || /^fallback\s*:/.test(line)) continue
    const parts = line.split(ARROW)
    if (parts.length !== 2) continue
    const matcher = parts[0].trim()
    const target = parts[1].trim()
    const id = matcherToService.get(matcher)
    if (!id) continue
    result.set(
      id,
      target === 'direct' || target === 'must_direct'
        ? { kind: 'direct' }
        : target === 'block'
          ? { kind: 'block' }
          : { kind: 'group', group: target },
    )
  }
  return result
}

/**
 * 把「服务 -> 动作」写回 routingA 文本。
 *
 * 规则：
 * - 认得出的服务行整行替换，按 ROUTING_SERVICES 的顺序统一生成，避免每次保存抖动；
 * - 认不出的行（含整行注释）原样保留，位置不变；
 * - 新生成的行插在第一条 fallback 之前，因为 fallback 之后不会被执行；
 * - 连续空行折叠成一个，反复保存不会把文件撑大。
 */
export function writeServiceRules(source: string, rules: ServiceRule[]): string {
  const matcherToService = new Map<string, ServiceId>()
  for (const item of ROUTING_SERVICES) matcherToService.set(item.matcher, item.id)

  const wanted = new Map<ServiceId, RoutingAction>()
  for (const rule of rules) {
    if (serviceById(rule.service)) wanted.set(rule.service, rule.action)
  }

  const kept: string[] = []
  for (const raw of source.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('')
      continue
    }
    // 整行注释原样保留：用户自己的备注比向导生成的规则更重要。
    if (trimmed.startsWith('#')) {
      kept.push(raw.replace(/\s+$/, ''))
      continue
    }
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const parts = line.split(ARROW)
    const matcher = parts.length === 2 ? parts[0].trim() : ''
    if (matcher && matcherToService.has(matcher)) continue
    kept.push(raw.replace(/\s+$/, ''))
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop()

  const generated: string[] = []
  for (const item of ROUTING_SERVICES) {
    const action = wanted.get(item.id)
    if (!action) continue
    generated.push(ruleLine(item.matcher, actionTarget(action)))
  }

  const fallbackIndex = kept.findIndex((line) => /^\s*fallback\s*:/.test(line))
  if (fallbackIndex < 0) {
    return `${[...kept, ...generated].join('\n')}\n`
  }
  return `${[...kept.slice(0, fallbackIndex), ...generated, ...kept.slice(fallbackIndex)].join('\n')}\n`
}

/** 一条规则都没配时，向导给出的默认建议：国内与内网直连，游戏 UDP 直连。 */
export const DEFAULT_SERVICE_RULES: ServiceRule[] = [
  { service: 'game-udp', action: { kind: 'direct' } },
  { service: 'lan', action: { kind: 'direct' } },
  { service: 'cn', action: { kind: 'direct' } },
]

// ---------------------------------------------------------------------------
// 自定义规则：geosite 分类 / geoip 国家 / 自定义域名 / IP / 端口
// ---------------------------------------------------------------------------

export type MatcherKind = 'domain-suffix' | 'domain-keyword' | 'domain-full' | 'geosite' | 'geoip' | 'ip' | 'port'

export interface CustomRule {
  kind: MatcherKind
  value: string
  action: RoutingAction
}

/**
 * 常见 geosite 分类，只是输入提示。
 *
 * 这里的每一项都会被用户点一下写进分流表，所以必须真实存在：
 * 早先这里有 `ads` 和 `epic`，但 geosite.dat 里叫 `category-ads-all` / `epicgames`，
 * 点了就生成一条让整张规则表加载失败的规则，只能靠保存时的校验兜住。
 *
 * 下面两组提示都由 geodata-codes 的白名单筛选一遍，白名单里查不到的名字
 * 不会出现在下拉里，从源头杜绝「提示给出一个不存在的分类」。
 */
const GEOSITE_WANTED = [
  'cn',
  'geolocation-!cn',
  'category-ads-all',
  'youtube',
  'netflix',
  'google',
  'apple',
  'amazon',
  'microsoft',
  'github',
  'telegram',
  'twitter',
  'spotify',
  'steam',
  'epicgames',
  'openai',
  'anthropic',
]

export const GEOSITE_HINTS: readonly string[] = GEOSITE_WANTED.filter(hasGeoSite)

/** 常见 geoip 国家代码，同样只是提示，同样先过一遍白名单。 */
const GEOIP_WANTED = ['cn', 'us', 'jp', 'hk', 'tw', 'sg', 'kr', 'private']

export const GEOIP_HINTS: readonly string[] = GEOIP_WANTED.filter(hasGeoIP)

export function matcherOf(kind: MatcherKind, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  switch (kind) {
    case 'domain-suffix':
      return `domain(suffix:${trimmed})`
    case 'domain-keyword':
      return `domain(keyword:${trimmed})`
    case 'domain-full':
      return `domain(full:${trimmed})`
    case 'geosite':
      return `domain(geosite:${trimmed})`
    case 'geoip':
      return `dip(geoip:${trimmed})`
    case 'ip':
      return `dip(${trimmed})`
    case 'port':
      return `l4proto(tcp) && dport(${trimmed})`
  }
}

/** 认得出的自定义匹配器反解成结构；认不出返回 null，交给高级编辑器。 */
export function customRuleOf(matcher: string, action: RoutingAction): CustomRule | null {
  const text = matcher.trim()
  const single = /^domain\((suffix|keyword|full|geosite):([^(),\s]+)\)$/.exec(text)
  if (single) {
    const kind = `domain-${single[1]}` as MatcherKind
    return single[1] === 'geosite' ? { kind: 'geosite', value: single[2], action } : { kind, value: single[2], action }
  }
  const geoip = /^dip\(geoip:([^(),\s]+)\)$/.exec(text)
  if (geoip) return { kind: 'geoip', value: geoip[1], action }
  const port = /^l4proto\(tcp\)\s*&&\s*dport\(([^()]+)\)$/.exec(text)
  if (port) return { kind: 'port', value: port[1], action }
  const ip = /^dip\(([^()]+)\)$/.exec(text)
  if (ip) return { kind: 'ip', value: ip[1], action }
  return null
}

function actionOfTarget(target: string): RoutingAction {
  if (target === 'direct' || target === 'must_direct') return { kind: 'direct' }
  if (target === 'block') return { kind: 'block' }
  return { kind: 'group', group: target }
}

/** 从文本里挑出向导能管理的自定义规则（服务预设之外的那些）。 */
export function parseCustomRules(source: string): CustomRule[] {
  const serviceMatchers = new Set(ROUTING_SERVICES.map((item) => item.matcher))
  const rules: CustomRule[] = []
  for (const raw of source.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line || /^fallback\s*:/.test(line)) continue
    const parts = line.split(ARROW)
    if (parts.length !== 2) continue
    const matcher = parts[0].trim()
    if (serviceMatchers.has(matcher)) continue
    const rule = customRuleOf(matcher, actionOfTarget(parts[1].trim()))
    if (rule) rules.push(rule)
  }
  return rules
}

/**
 * 同时写服务规则与自定义规则。
 *
 * 顺序：自定义规则在前，服务预设在后——用户显式写的规则应该先匹配到。
 * 认不出的行（含注释、`&&`/`||` 组合的复杂匹配器）一律原样保留。
 */
export function writeRules(source: string, services: ServiceRule[], custom: CustomRule[]): string {
  const serviceMatchers = new Set(ROUTING_SERVICES.map((item) => item.matcher))
  const wanted = new Map<ServiceId, RoutingAction>()
  for (const rule of services) {
    if (serviceById(rule.service)) wanted.set(rule.service, rule.action)
  }

  const kept: string[] = []
  for (const raw of source.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('')
      continue
    }
    if (trimmed.startsWith('#')) {
      kept.push(raw.replace(/\s+$/, ''))
      continue
    }
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const parts = line.split(ARROW)
    const matcher = parts.length === 2 ? parts[0].trim() : ''
    if (matcher && serviceMatchers.has(matcher)) continue
    if (matcher && customRuleOf(matcher, { kind: 'direct' })) continue
    kept.push(raw.replace(/\s+$/, ''))
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop()

  const generated: string[] = []
  const seen = new Set<string>()
  for (const rule of custom) {
    const matcher = matcherOf(rule.kind, rule.value)
    if (!matcher || seen.has(matcher)) continue
    seen.add(matcher)
    generated.push(ruleLine(matcher, actionTarget(rule.action)))
  }
  for (const item of ROUTING_SERVICES) {
    const action = wanted.get(item.id)
    if (!action) continue
    generated.push(ruleLine(item.matcher, actionTarget(action)))
  }

  const fallbackIndex = kept.findIndex((line) => /^\s*fallback\s*:/.test(line))
  if (fallbackIndex < 0) {
    return `${[...kept, ...generated].join('\n')}\n`
  }
  return `${[...kept.slice(0, fallbackIndex), ...generated, ...kept.slice(fallbackIndex)].join('\n')}\n`
}
