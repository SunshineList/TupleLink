import type { NodeLatencyProbeResult } from '~/apis'
import { hasMeasuredLatency } from './latency'

export function summarizePickerLatencies(ids: string[], latencies?: Record<string, NodeLatencyProbeResult>) {
  const unique = new Set(ids)
  let measured = 0
  let alive = 0
  let fastest: NodeLatencyProbeResult | undefined
  for (const id of unique) {
    const result = latencies?.[id]
    if (!result) continue
    measured++
    if (!hasMeasuredLatency(result)) continue
    alive++
    if (!fastest || result.latencyMs! < fastest.latencyMs!) fastest = result
  }
  return { total: unique.size, measured, alive, fastest }
}
