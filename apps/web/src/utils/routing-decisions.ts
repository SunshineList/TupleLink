/**
 * 把 dae 内核的 debug 日志还原成「这条连接走了哪个出口」。
 *
 * 为什么需要这一层：
 * dae 的路由日志是给开发者看的文本，形如
 *   level=debug msg="routing match set len: 3/1024 set=proxy"
 *   level=debug msg="sniffed domain: www.youtube.com"
 *   level=debug msg="dial ... outbound=proxy"
 * 用户在日志页只能一行行翻，**看不出某个域名最终命中哪条规则、走的哪个群组**。
 *
 * 这里只做解析和归并，不改日志本身：
 * 认不出的行一律忽略，绝不猜测出口 —— 猜错比没有更糟，
 * 用户会拿着错误的结论去改分流表。
 *
 * ⚠️ 前提：log_level 必须是 debug 或 trace。info 级别下内核根本不打印
 * 路由匹配行，此时界面要明确告诉用户去改级别，而不是显示「无数据」。
 */

/** 一条连接的最终去向。 */
export type ExitKind = 'proxy' | 'direct' | 'block' | 'must_direct' | 'unknown'

export interface RoutingDecision {
  /** 嗅探到的域名；纯 IP 连接时为空。 */
  domain: string
  /** 目标 IP（能解析到时）。 */
  host: string
  /** 命中的规则动作：group 名，或 direct / block / must_direct。 */
  target: string
  kind: ExitKind
  /** 原始日志行，方便用户核对。 */
  raw: string
}

/**
 * `set=proxy` / `set=direct` / `set=block`，以及 dae 的 must_direct。
 *
 * 注意取值可能落在 logrus 的 `msg="…"` 引号里，此时行尾是 `set=proxy"`，
 * 所以值要允许以引号结尾，并在取值时统一剥掉。
 */
const VALUE = `("?[^"\\s]+"?|[^"\\s]*)`
const SET_FIELD = new RegExp(`\\bset=${VALUE}`)
const OUTBOUND_FIELD = new RegExp(`\\boutbound=${VALUE}`)
const SNIFF_DOMAIN = /\b(?:sniffed domain|domain):\s*"?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})"?/i
const SNIFF_HOST = /\b(?:sniffed ip|dest(?:ination)?):\s*"?(\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])"?/i

/** 去掉 logrus 引号与残留的边界符号。 */
function cleanValue(raw: string | undefined): string {
  if (!raw) return ''
  return raw.replace(/^"/, '').replace(/"$/, '').trim()
}

/** `set=xxx` 的取值翻译成固定分类，未知的一律当群组名。 */
export function exitKindOf(target: string): ExitKind {
  switch (target) {
    case 'direct':
      return 'direct'
    case 'must_direct':
      return 'must_direct'
    case 'block':
      return 'block'
    case '':
      return 'unknown'
    default:
      // 其余都是用户自定义群组名，说明这条流量走了代理。
      return 'proxy'
  }
}

/**
 * 解析单条日志行。
 *
 * 一行里可能同时出现多个字段；只有带 `set=` 或 `outbound=` 的才算决策行。
 * 单独一个嗅探结果不构成决策 —— 后面的配置行会把动作改写掉，
 * 提前输出会让用户看到错误的出口。
 */
export function parseDecision(raw: string): RoutingDecision | null {
  const setValue = cleanValue(SET_FIELD.exec(raw)?.[1])
  const outboundValue = cleanValue(OUTBOUND_FIELD.exec(raw)?.[1])
  const target = setValue || outboundValue
  if (!target) return null
  const kind = exitKindOf(target)
  if (kind === 'unknown') return null
  return {
    domain: SNIFF_DOMAIN.exec(raw)?.[1]?.toLowerCase() ?? '',
    host: SNIFF_HOST.exec(raw)?.[1] ?? '',
    target,
    kind,
    raw,
  }
}

/** 日志里是否压根没有路由匹配行，用来区分「没开 debug」和「真没流量」。 */
export function hasRoutingTrace(lines: string[]): boolean {
  return lines.some((line) => SET_FIELD.test(line) || OUTBOUND_FIELD.test(line))
}

/**
 * 归类成展示用的分组。
 *
 * 直连（direct / must_direct）合并成一组：用户关心的是「有没有走代理」，
 * 区分这两者只在排查本机流量时才有意义。
 */
export function exitGroupOf(kind: ExitKind): 'proxy' | 'direct' | 'block' | 'unknown' {
  if (kind === 'must_direct') return 'direct'
  return kind
}

/**
 * 按域名归并，保留最后一次决策。
 *
 * dae 对同一个域名会反复重选 dialer，一次浏览会产生大量重复行；
 * 用户要看的是「这个站点现在走哪条线」，所以后来的覆盖先前的。
 */
export function summarizeDecisions(decisions: RoutingDecision[], limit = 50): RoutingDecision[] {
  const latest = new Map<string, RoutingDecision>()
  for (const item of decisions) {
    // 没有域名时用目标 IP 当 key，都没有就跳过 —— 无法归因的行不该占据一条。
    const key = item.domain || item.host
    if (!key) continue
    latest.delete(key)
    latest.set(key, item)
  }
  // Map 保留插入顺序，最后插入的就是最近的；倒过来让最新在最上面。
  return [...latest.values()].reverse().slice(0, limit)
}
