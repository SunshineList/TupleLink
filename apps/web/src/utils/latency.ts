import type { TFunction } from 'i18next'
import type { NodeLatencyProbeResult } from '~/apis'

export function hasMeasuredLatency(result?: NodeLatencyProbeResult) {
  return result?.alive === true && Number.isFinite(result.latencyMs) && result.latencyMs! >= 0
}

export function latencyTone(result?: NodeLatencyProbeResult): 'good' | 'warning' | 'bad' | 'unmeasured' {
  if (!result) return 'unmeasured'
  if (result.alive === false) return 'bad'
  if (!hasMeasuredLatency(result)) return 'unmeasured'
  if (result.latencyMs! < 200) return 'good'
  if (result.latencyMs! < 500) return 'warning'
  return 'bad'
}

export function formatLatencyLabel(result: NodeLatencyProbeResult | undefined, t: TFunction) {
  if (!result) {
    return undefined
  }
  if (result.alive === false) {
    const reasons = {
      invalid_node: 'invalidNode',
      dns_failed: 'dns',
      tls_failed: 'tls',
      connection_refused: 'refused',
      connection_closed: 'closed',
      timeout: 'timeout',
      cancelled: 'cancelled',
      authentication_failed: 'authentication',
      check_target_failed: 'target',
      udp_unsupported: 'udpUnsupported',
    } as const
    const reason =
      result.message && Object.hasOwn(reasons, result.message)
        ? reasons[result.message as keyof typeof reasons]
        : undefined
    if (reason) return t(`latency.nodeFailure.${reason}`)
    return t('latency.failed')
  }
  if (hasMeasuredLatency(result)) {
    return `${result.latencyMs} ms`
  }
  return t('latency.unavailable')
}
