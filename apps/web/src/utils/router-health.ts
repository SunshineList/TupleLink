// The router ships a read-only diagnostic payload from /usr/libexec/daed/check
// (exposed as the `daed-router status` RPC). The panel used to ignore it, so a
// firmware that cannot load eBPF looked identical to a healthy one until the
// user pressed Start and read the log. These helpers keep the summarising logic
// pure so it can be unit tested without a router.

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
  checks?: RouterCheck[]
}

export type HealthLevel = 'ok' | 'warning' | 'error' | 'unknown'

export interface HealthSummary {
  level: HealthLevel
  ok: number
  warning: number
  error: number
  // Checks that block starting the proxy, ordered as the router reported them.
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

// A router-reported error means the proxy cannot start even though the service
// itself may be installed, so it outranks the runtime state in the header chip.
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

// `uninstalled` is what daed-check prints when /usr/share/daed-router/version is
// missing, which happens on a half-removed install rather than a real release.
export function formatVersion(status?: RouterStatus | null): string {
  const version = status?.version?.trim()
  if (!version || version === 'uninstalled') return ''
  return version
}

export function formatPlatform(status?: RouterStatus | null): string {
  const parts = [status?.firmware, status?.release].filter((part): part is string => !!part && part !== 'unknown')
  return parts.join(' ')
}

export function shouldOfferStart(status?: RouterStatus | null): boolean {
  return !!status && status.running === false && status.compatible !== false
}
