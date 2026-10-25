// 刷机、换设备、重装都要从头配一遍节点、订阅、群组和分流规则。
// 安装器的备份只服务于卸载回滚，解不出来也给不回面板；
// 所以面板自己定义一份人可读的 JSON 快照，导出即备份，导入即恢复。
//
// 这里的函数全部是纯函数：不碰 window、不碰 GraphQL，
// 可以在 Node 里直接跑单元测试。

export const BACKUP_KIND = 'nailink-config'
export const BACKUP_VERSION = 1

/** 面板能读到的全局配置字段，与 GraphQL 的 `global` 选择集一一对应。 */
export interface BackupGlobal {
  allowInsecure?: boolean | null
  autoConfigKernelParameter?: boolean | null
  bandwidthMaxRx?: string | null
  bandwidthMaxTx?: string | null
  bootstrapResolver?: string | null
  checkInterval?: string | null
  checkTolerance?: string | null
  dialMode?: string | null
  disableWaitingNetwork?: boolean | null
  enableLocalTcpFastRedirect?: boolean | null
  fallbackResolver?: string | null
  lanInterface?: string[] | null
  logLevel?: string | null
  mptcp?: boolean | null
  pprofPort?: number | null
  sniffingTimeout?: string | null
  soMarkFromDaE?: number | null
  soMarkFromDae?: number | null
  tcpCheckHttpMethod?: string | null
  tcpCheckUrl?: string[] | null
  tlsImplementation?: string | null
  tproxyPort?: number | null
  tproxyPortProtect?: boolean | null
  udpCheckDns?: string[] | null
  utlsImitate?: string | null
  wanInterface?: string[] | null
}

export interface BackupConfig {
  name: string
  selected: boolean
  global: BackupGlobal
}

export interface BackupRouting {
  name: string
  selected: boolean
  routing: string
}

export interface BackupDNS {
  name: string
  selected: boolean
  dns: string
  routing?: { request: string, response: string } | null
}

export interface BackupGroup {
  name: string
  policy: string
  policyParams: { key: string, val: string }[]
  /** 组内节点的订阅链接；用链接而不是数据库 ID，换设备后仍然对得上。 */
  nodeLinks: string[]
  /** 组内订阅的分享链接，同理。 */
  subscriptionLinks: string[]
  /** 每个订阅的节点名过滤正则，与 subscriptionLinks 按下标对应。 */
  subscriptionFilters: (string | null)[]
}

export interface ConfigBackup {
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: string
  configs: BackupConfig[]
  routings: BackupRouting[]
  dnss: BackupDNS[]
  groups: BackupGroup[]
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupFormatError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

// 未知字段原样保留：上游加了新配置项时，导入不应该把它当成脏数据丢掉，
// 只要它还是合法的 JSON 标量/数组。
function readGlobal(value: unknown): BackupGlobal {
  if (!isRecord(value)) return {}
  const global: BackupGlobal = {}
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      global[key as keyof BackupGlobal] = raw as never
      continue
    }
    const list = readStringArray(raw)
    if (list) global[key as keyof BackupGlobal] = list as never
  }
  return global
}

// 链接里可能带凭据，导出的快照本身就是敏感文件，不写进日志也不做脱敏——
// 脱敏后就没法导入回去了。
function readGroups(value: unknown): BackupGroup[] {
  if (!Array.isArray(value)) return []
  const groups: BackupGroup[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = readString(item.name)?.trim()
    if (!name) continue
    const params = Array.isArray(item.policyParams) ? item.policyParams : []
    groups.push({
      name,
      policy: readString(item.policy) || 'min_moving_avg',
      policyParams: params
        .filter(isRecord)
        .map((param) => ({ key: readString(param.key) || '', val: readString(param.val) || '' }))
        .filter((param) => param.key.length > 0),
      nodeLinks: readStringArray(item.nodeLinks) || [],
      subscriptionLinks: readStringArray(item.subscriptionLinks) || [],
      subscriptionFilters: Array.isArray(item.subscriptionFilters)
        ? item.subscriptionFilters.map((filter) => readString(filter) ?? null)
        : [],
    })
  }
  return groups
}

/**
 * 解析一份备份文件。
 *
 * 只做结构校验，不做「能不能用」的判断：导入后仍然可能出现链接失效或
 * 规则语法错误，那些交给现有的订阅导入和配置校验流程去报。
 */
export function parseBackup(text: string): ConfigBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupFormatError('文件不是合法的 JSON。')
  }
  if (!isRecord(raw)) throw new BackupFormatError('备份文件的顶层必须是一个对象。')
  if (raw.kind !== BACKUP_KIND) {
    throw new BackupFormatError('这不是 NaiLink 面板导出的配置文件。')
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new BackupFormatError('备份文件的格式版本比当前面板更新，请先升级插件。')
  }

  const configs = Array.isArray(raw.configs) ? raw.configs : []
  const routings = Array.isArray(raw.routings) ? raw.routings : []
  const dnss = Array.isArray(raw.dnss) ? raw.dnss : []

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: readString(raw.exportedAt) || new Date().toISOString(),
    configs: configs
      .filter(isRecord)
      .map((config) => ({
        name: readString(config.name)?.trim() || 'global',
        selected: config.selected === true,
        global: readGlobal(config.global),
      })),
    routings: routings
      .filter(isRecord)
      .map((routing) => ({
        name: readString(routing.name)?.trim() || 'default',
        selected: routing.selected === true,
        routing: readString(routing.routing) || '',
      }))
      .filter((routing) => routing.routing.length > 0),
    dnss: dnss
      .filter(isRecord)
      .map((entry) => {
        const routing = isRecord(entry.routing)
          ? {
              request: readString(entry.routing.request) || '',
              response: readString(entry.routing.response) || '',
            }
          : null
        return {
          name: readString(entry.name)?.trim() || 'default',
          selected: entry.selected === true,
          dns: readString(entry.dns) || '',
          routing,
        }
      })
      .filter((entry) => entry.dns.length > 0),
    groups: readGroups(raw.groups),
  }
}

/** 一份备份里有多少可直接统计的东西，用来在导入前给用户一个预期。 */
export interface BackupSummary {
  configs: number
  routings: number
  dnss: number
  groups: number
  nodes: number
  subscriptions: number
}

export function summariseBackup(backup: ConfigBackup): BackupSummary {
  return {
    configs: backup.configs.length,
    routings: backup.routings.length,
    dnss: backup.dnss.length,
    groups: backup.groups.length,
    nodes: backup.groups.reduce((total, group) => total + group.nodeLinks.length, 0),
    subscriptions: backup.groups.reduce((total, group) => total + group.subscriptionLinks.length, 0),
  }
}

/**
 * 生成导出内容。
 *
 * `exportedAt` 由调用方传入，避免同一个快照两次导出得到不同的字节，
 * 也能让测试断言稳定。
 */
export function buildBackup(input: {
  configs: BackupConfig[]
  routings: BackupRouting[]
  dnss: BackupDNS[]
  groups: BackupGroup[]
  exportedAt: string
}): ConfigBackup {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt,
    configs: input.configs,
    routings: input.routings,
    dnss: input.dnss,
    groups: input.groups,
  }
}

/** 建议的下载文件名：带日期，多次导出不会互相覆盖。 */
export function backupFileName(exportedAt: string): string {
  const day = exportedAt.slice(0, 10)
  return `nailink-config-${day || 'backup'}.json`
}
