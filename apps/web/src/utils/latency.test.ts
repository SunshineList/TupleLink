import type { NodeLatencyProbeResult } from '~/apis'
import { describe, expect, it } from 'vitest'
import { hasMeasuredLatency, latencyTone } from './latency'

const measured = (latencyMs: number): NodeLatencyProbeResult => ({
  id: 'fixture',
  alive: true,
  latencyMs,
  testedAt: '',
})
describe('latency colors', () => {
  it.each([
    [0, 'good'],
    [199, 'good'],
    [200, 'warning'],
    [499, 'warning'],
    [500, 'bad'],
    [1500, 'bad'],
  ] as const)('colors %d ms as %s', (latency, tone) => {
    expect(latencyTone(measured(latency))).toBe(tone)
  })
  it('marks failed probes red even when an old latency exists', () => {
    const failed = { ...measured(18), alive: false }
    expect(latencyTone(failed)).toBe('bad')
    expect(hasMeasuredLatency(failed)).toBe(false)
  })
  it('does not classify unknown or invalid measurements as good', () => {
    expect(latencyTone()).toBe('unmeasured')
    for (const value of [-1, Infinity, NaN]) expect(latencyTone(measured(value))).toBe('unmeasured')
    expect(latencyTone({ ...measured(1), latencyMs: null })).toBe('unmeasured')
  })
})
