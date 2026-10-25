// 路由器侧会从 /usr/libexec/daed/check 产出一份只读诊断载荷
// （通过 `daed-router status` RPC 暴露给面板）。以前面板完全忽略它，
// 导致一个无法加载 eBPF 的固件看起来和健康固件一模一样，
// 直到用户按下「启动」再看日志才发现。这里把这些辅助函数保持纯函数，
// 这样不需要真机也可以跑单元测试。

export type RouterCheckStatus = 'ok' | 'warning' | 'error'

export interface RouterCheck {
  name: string
  status: RouterCheckStatus
  message: string
}

export interface RouterStatus {
  firmware?: string
  release?: string
  architecture?: string
  kernel?: string
  listen?: string
  version?: string
  compatible?: boolean
  running?: boolean
  enabled?: boolean
  autostart?: boolean
  // luci-app-daed-router 提供 LuCI 菜单入口；只装 daed-router 时这里为 false。
  luci?: boolean
  checks?: RouterCheck[]
}

export type HealthLevel = 'ok' | 'warning' | 'error' | 'unknown'

export interface HealthSummary {
  level: HealthLevel
  ok: number
  warning: number
  error: number
  // 会阻断代理启动的检查项，按路由器报告的顺序排列。
  blocking: RouterCheck[]
}

const RANK: Record<HealthLevel, number> = { ok: 0, unknown: 1, warning: 2, error: 3 }

function normaliseStatus(value: unknown): RouterCheckStatus {
  return value === 'ok' || value === 'warning' || value === 'error' ? value : 'warning'
}

export function readChecks(status?: RouterStatus | null): RouterCheck[] {
  if (!status || !Array.isArray(status.checks)) return []
  return status.checks
    .filter((check): check is RouterCheck => !!check && typeof check.name === 'string' && check.name.length > 0)
    .map((check) => ({
      name: check.name,
      status: normaliseStatus(check.status),
      message: typeof check.message === 'string' ? check.message : '',
    }))
}

export function summariseHealth(status?: RouterStatus | null): HealthSummary {
  const checks = readChecks(status)
  const ok = checks.filter((check) => check.status === 'ok').length
  const warning = checks.filter((check) => check.status === 'warning').length
  const error = checks.filter((check) => check.status === 'error').length
  const level: HealthLevel = !checks.length ? 'unknown' : error ? 'error' : warning ? 'warning' : 'ok'
  return { level, ok, warning, error, blocking: checks.filter((check) => check.status === 'error') }
}

// 只要路由器报了 error，即使服务已经装好也无法启动代理，
// 所以在头部胶囊里 error 的优先级高于运行时状态。
export function serviceLevel(status?: RouterStatus | null): HealthLevel {
  const health = summariseHealth(status)
  if (health.level === 'error') return 'error'
  if (status?.running) return 'ok'
  if (status?.running === false) return 'warning'
  return health.level
}

// Checks worth surfacing above the fold: everything that is not plain "ok",
// with blocking errors first so the reason a start would fail is never buried.
export function attentionChecks(status?: RouterStatus | null): RouterCheck[] {
  return readChecks(status)
    .filter((check) => check.status !== 'ok')
    .sort((a, b) => RANK[b.status] - RANK[a.status])
}

// 当 /usr/share/daed-router/version 文件缺失时 daed-check 会输出字面量 `uninstalled`，
// 这通常出现在卸载未彻底的场景，不是真正的版本号。
export function formatVersion(status?: RouterStatus | null): string {
  const version = status?.version?.trim()
  if (!version || version === 'uninstalled') return ''
  return version
}

export function formatPlatform(status?: RouterStatus | null): string {
  const parts = [status?.firmware, status?.release].filter((part): part is string => !!part && part !== 'unknown')
  return parts.join(' ')
}

// 只装了 daed-router 的情况下 ubus 方法与面板资源都在，但 LuCI 菜单里没有入口。
// 用户从「系统 - 软件包」看是装好的，却找不到面板，只能去猜。
export function panelMissing(status?: RouterStatus | null): boolean {
  return status?.luci === false
}

export function shouldOfferStart(status?: RouterStatus | null): boolean {
  return !!status && status.running === false && status.compatible !== false
}

// 官方支持的架构能跑完整数据面，试验架构则已知在常见 32 位内核上
// 加载不了必需的 BPF 回调。用户拿到的只是「安装失败」或「延迟全红」，
// 却看不出根因就是手里这块板子，所以把架构结论单独拎出来给一句人话。
export type ArchitectureTier = 'supported' | 'experimental' | 'unsupported' | 'unknown'

const EXPERIMENTAL_ARCHES = new Set(['armv7', 'armv7l', 'mips', 'mipsel', 'mipsle'])

export function architectureTier(architecture?: string | null): ArchitectureTier {
  const arch = architecture?.trim().toLowerCase()
  if (!arch || arch === 'unknown') return 'unknown'
  if (arch === 'x86_64' || arch === 'aarch64') return 'supported'
  if (EXPERIMENTAL_ARCHES.has(arch)) return 'experimental'
  return 'unsupported'
}

// `autostart` 对应 /etc/init.d/daed enable，是唯一能跨重启保留的状态；
// `enabled` 只表示守护进程当前允许运行。
// 一旦在已开机自启的安装上手动停掉代理，两者就会不一致，
// 相互推导会让开关位置显示错误。
export type BootState = 'enabled' | 'disabled' | 'unknown'

export function bootState(status?: RouterStatus | null): BootState {
  if (typeof status?.autostart === 'boolean') return status.autostart ? 'enabled' : 'disabled'
  return 'unknown'
}

// 发送与当前状态**相反**的动作；如果路由器没有上报状态则返回 null，
// 让开关保持禁用而不是去猜。
export function bootAction(state: BootState): 'boot_enable' | 'boot_disable' | null {
  if (state === 'enabled') return 'boot_disable'
  if (state === 'disabled') return 'boot_enable'
  return null
}
