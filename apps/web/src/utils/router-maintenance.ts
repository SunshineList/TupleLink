import { i18n } from '~/i18n'

export interface MaintenanceJob {
  id: string
  action: 'check' | 'update' | 'geodata'
  state: 'queued' | 'running' | 'success' | 'error'
  phase: string
  code?: string
  target?: string
  started: number
  updated: number
}
export interface MaintenanceStatus {
  success: boolean
  code?: string
  current: string
  latest?: { version: string; tag: string; checked: number }
  geodata?: { version: string; tag: string; checked: number }
  job?: MaintenanceJob
}

// 维护结果码到文案的映射。文案本身在 locales 里，`errors` 段共用同一套 code，
// 这样后端新增一个码时前端不会静默显示空白。
export const maintenanceMessages: Record<string, string> = {
  busy: 'maintenance.busy',
  check_required: 'maintenance.check_required',
  already_latest: 'maintenance.already_latest',
  permission_denied: 'maintenance.permission_denied',
  worker_unavailable: 'maintenance.worker_unavailable',
  download_failed: 'maintenance.download_failed',
  invalid_release: 'maintenance.invalid_release',
  checksum_failed: 'maintenance.checksum_failed',
  invalid_installer: 'maintenance.invalid_installer',
  install_failed: 'maintenance.install_failed',
  install_missing: 'maintenance.install_missing',
  version_changed: 'maintenance.version_changed',
  unsupported: 'maintenance.unsupported',
  no_space: 'maintenance.no_space',
  backup_failed: 'maintenance.backup_failed',
  service_not_ready: 'maintenance.service_not_ready',
  custom_geodata: 'maintenance.custom_geodata',
  invalid_geodata: 'maintenance.invalid_geodata',
  configuration_modified: 'maintenance.configuration_modified',
  apply_failed: 'maintenance.apply_failed',
  apply_unconfirmed: 'maintenance.apply_unconfirmed',
  rollback_failed: 'maintenance.rollback_failed',
  backend_unavailable: 'maintenance.backend_unavailable',
  unsafe_state: 'maintenance.unsafe_state',
  state_failed: 'maintenance.state_failed',
  interrupted: 'maintenance.interrupted',
  operation_failed: 'maintenance.operation_failed',
}

export function jobActive(job?: MaintenanceJob) {
  return job?.state === 'queued' || job?.state === 'running'
}
export function newerVersion(next: string, current: string) {
  const a = next.split('.').map(Number)
  const b = current.split('-')[0].split('.').map(Number)
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((value) => !Number.isFinite(value))) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

async function maintenanceRPC(method: 'maintenance' | 'maintain', action?: string): Promise<MaintenanceStatus> {
  const host = window.parent as Window & {
    L?: {
      require: (
        name: string,
      ) => Promise<{ declare: (spec: object) => (...args: string[]) => Promise<MaintenanceStatus> }>
    }
  }
  if (host === window || !host.L?.require) throw new Error(i18n.t('maintenance.hostUnavailable'))
  const rpc = await host.L.require('rpc')
  const result = await rpc.declare({
    object: 'daed-router',
    method,
    params: method === 'maintain' ? ['action'] : [],
    expect: {},
    raise: true,
  })(...(action ? [action] : []))
  if (!result || typeof result.success !== 'boolean') throw new Error(i18n.t('maintenance.bridgeUnavailable'))
  if (!result.success)
    throw new Error(i18n.t(maintenanceMessages[result.code || ''] || maintenanceMessages.operation_failed, {
      defaultValue: i18n.t('maintenance.operation_failed'),
    }))
  return result
}
export const readMaintenance = () => maintenanceRPC('maintenance')
export const startMaintenance = (action: 'check' | 'update' | 'geodata') => maintenanceRPC('maintain', action)
