/**
 * 群组当前实际选中的节点。
 *
 * 面板能看到群组里有哪些节点、各自延迟多少，但**看不到当前在用哪一个**。
 * min_moving_avg / min 这类策略下节点会随线路波动随时切换，
 * 界面却完全不反映，于是「网慢了」时没法判断是不是切到了差节点。
 *
 * 数据来自后端 /health/ready?details=1 里的 candidate_ipv4 / candidate_ipv6，
 * 那正是内核当前实际选择的结果，不是界面猜的。
 */

export interface GroupCandidate {
  name: string
  policy: string
  /** 当前选中的 IPv4 节点名，空串表示该协议族还没选出稳定候选。 */
  candidateIPv4: string
  /** 当前选中的 IPv6 节点名。 */
  candidateIPv6: string
  /** 群组内节点数；后端给的是字符串，这里统一转成数字或 null。 */
  members: number | null
}

export interface GroupCandidateResult {
  groups: GroupCandidate[]
  /** 数据是否取到。false 时界面要说清楚是「读不到」而不是「没有群组」。 */
  available: boolean
}

const EMPTY: GroupCandidateResult = { groups: [], available: false }

export async function readGroupCandidates(): Promise<GroupCandidateResult> {
  const host = window.parent as Window & {
    L?: { require: (name: string) => Promise<{ declare: (spec: object) => () => Promise<unknown> }> }
  }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  const rpc = await host.L.require('rpc')
  const result = (await rpc.declare({
    object: 'daed-router',
    method: 'groups',
    expect: {},
    reject: true,
    raise: true,
  })()) as { groups?: unknown } | undefined

  if (!result || !Array.isArray(result.groups)) return EMPTY

  const groups: GroupCandidate[] = []
  for (const item of result.groups) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name : ''
    // 没有名字的行直接丢掉：界面上显示一行空白比不显示更让人困惑。
    if (!name) continue
    const members = Number(row.members)
    groups.push({
      name,
      policy: typeof row.policy === 'string' ? row.policy : '',
      candidateIPv4: typeof row.candidate_ipv4 === 'string' ? row.candidate_ipv4 : '',
      candidateIPv6: typeof row.candidate_ipv6 === 'string' ? row.candidate_ipv6 : '',
      members: Number.isFinite(members) && members > 0 ? members : null,
    })
  }
  return { groups, available: true }
}

/**
 * 一个群组「现在在用哪个节点」。
 *
 * 双栈时 v4 和 v6 可能选到不同节点，所以两个都保留；
 * 用户关心的是「名字」，只有一个时就不必重复展示。
 */
export function activeCandidates(group: GroupCandidate): string[] {
  const names = [group.candidateIPv4, group.candidateIPv6].filter((name) => name.length > 0)
  // 双栈选到同一节点时去重，避免显示两遍。
  return [...new Set(names)]
}

/**
 * 随机策略没有稳定候选，后端会留空。
 *
 * 这种情况界面必须说「随机策略无固定出口」，
 * 而不是显示成「没选中节点」——后者看起来像故障。
 */
export function selectionIsRandom(policy: string): boolean {
  return policy.toLowerCase() === 'random'
}
