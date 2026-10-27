/**
 * WireGuard 接入检测。
 *
 * 为什么需要这个：
 * dae 用 eBPF 挂在网卡上做透明代理，**只接管 `lan_interface` 列表里的接口**。
 * 用户从外面用 WireGuard 连回家（`wg0`），如果 `wg0` 不在这个列表里，
 * 流量会直接 `wg0 -> wan` 转发出去，**完全绕过 dae**。
 *
 * 现象是「连上了、内网能访问、但上不了外网」，而家里设备一切正常，
 * 很容易被误判成「节点坏了」。OpenClash 之类用 nftables forward 链的工具
 * 不会有这个问题，所以对比着看更让人困惑。
 *
 * 这里只做判断和建议，**不自动修改用户配置** —— 静默改 lan_interface
 * 会让别的接口行为一起变，代价比收益大。改由用户在界面上确认。
 */

/** 一个网络接口的最小信息，字段与 GraphQL 的 interfaces 对齐。 */
export interface InterfaceInfo {
  name: string
  ip: string[]
}

/** 判断某个接口是不是 WireGuard 隧道。 */
export function isWireGuard(name: string): boolean {
  // OpenWrt 默认 wg0 / wg1；用户也可能起 wg-home、vpn-wg 这类名字。
  // 但 `wan` 开头的普通接口不能误判，所以要求 wg 出现在词边界上。
  return /(?:^|[-_])wg\d*(?:$|[-_\d])/i.test(name)
}

/** 从接口的 IP 列表里取出私网网段（用于提示 WG 网段会被 geoip:private 吃掉）。 */
export function privateCidrOf(iface: InterfaceInfo): string[] {
  const result: string[] = []
  for (const entry of iface.ip) {
    const value = entry.trim()
    // 只认带前缀的写法，形如 10.8.0.1/24。
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(value)
    if (!match) continue
    const [, address, prefix] = match
    const octets = address.split('.').map(Number)
    // 只保留私网段，公网地址的 wg 不涉及 geoip:private 冲突。
    const isPrivate =
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    if (isPrivate) result.push(`${address}/${prefix}`)
  }
  return result
}

export interface WireGuardCheck {
  /** 检测到的 WireGuard 接口名。 */
  wireguard: string[]
  /** 没被 lan_interface 覆盖的那些，这些接口进来的流量不会被代理。 */
  uncovered: string[]
  /** 需要提醒用户把网段规则排到 geoip:private 之前。 */
  privateCidrs: string[]
  /** 给界面直接用的一句话结论，为空表示没有问题。 */
  message: string
  /** 建议补进 lan_interface 的值。 */
  suggestion: string[]
}

/**
 * 检查 WireGuard 接口与 lan_interface 的关系。
 *
 * 两种情况都不报：
 *  - 没装 WireGuard（没有 wg 接口），这跟本项目无关；
 *  - wg 接口已经全在 lan_interface 里，配置是对的。
 */
export function checkWireGuard(interfaces: InterfaceInfo[], lanInterface: string[]): WireGuardCheck {
  const wireguard = interfaces.filter((item) => isWireGuard(item.name)).map((item) => item.name)
  if (wireguard.length === 0) {
    return { wireguard: [], uncovered: [], privateCidrs: [], message: '', suggestion: [] }
  }

  const covered = new Set(lanInterface.map((item) => item.trim()))
  const uncovered = wireguard.filter((item) => !covered.has(item))

  const privateCidrs: string[] = []
  for (const iface of interfaces) {
    if (!isWireGuard(iface.name)) continue
    if (covered.has(iface.name)) privateCidrs.push(...privateCidrOf(iface))
  }

  if (uncovered.length === 0) {
    // 接口已经绑好了；但如果它是私网段，仍然有第二个坑要提醒。
    if (privateCidrs.length > 0) {
      return {
        wireguard,
        uncovered: [],
        privateCidrs,
        message: 'wireguardPrivateRule',
        suggestion: [],
      }
    }
    return { wireguard, uncovered: [], privateCidrs: [], message: '', suggestion: [] }
  }

  return {
    wireguard,
    uncovered,
    privateCidrs,
    message: 'wireguardNotBound',
    suggestion: uncovered,
  }
}

/** 分流表里 `dip(geoip:private) -> direct` 是否排在 WG 网段规则之前。 */
export interface PrivateOrderIssue {
  /** 私网直连规则所在的行号（从 0 开始）。 */
  privateRuleLine: number
  /** 是否存在比它更早的、针对 WG 网段的规则。 */
  hasEarlierWireGuardRule: boolean
  /** 这条私网规则的动作是不是 direct 类。 */
  isDirect: boolean
}

const PRIVATE_RULE = /^\s*dip\(\s*geoip\s*:\s*private\s*\)\s*->\s*(\S+)\s*$/i

/**
 * 找出 `dip(geoip:private) -> direct` 的位置。
 *
 * WG 网段都在私网范围内，这条规则一旦命中，后面的分流规则全部不会执行。
 * 用户需要把 WG 网段的规则写在它**上面**，或者把它删掉/改写。
 */
export function findPrivateRule(source: string): PrivateOrderIssue | null {
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].replace(/#.*$/, '').trim()
    if (!raw) continue
    const match = PRIVATE_RULE.exec(raw)
    if (!match) continue
    const target = match[1].toLowerCase()
    const hasEarlier = lines
      .slice(0, index)
      .some((line) => /dip\(\s*\d{1,3}(?:\.\d{1,3}){3}\s*\/\s*\d{1,2}\s*\)/.test(line))
    return {
      privateRuleLine: index,
      hasEarlierWireGuardRule: hasEarlier,
      isDirect: target === 'direct' || target === 'must_direct',
    }
  }
  return null
}

/**
 * 给出把 WG 网段抢在私网直连之前的具体改法。
 *
 * 只生成建议文本，不改用户的表 —— 网段写法（用哪个 IP 段）必须由用户确认，
 * 猜错会把整个网段导去代理。
 */
export function suggestPrivateReorder(source: string, cidr: string, group: string): string {
  const lines = source.split('\n')
  const rule = `dip(${cidr}) -> ${group}`
  const privateRule = findPrivateRule(source)
  if (!privateRule) return [rule, ...lines].join('\n')
  const next = [...lines]
  next.splice(privateRule.privateRuleLine, 0, rule)
  return next.join('\n')
}
