import { describe, expect, it } from 'vitest'
import { summarizePickerLatencies } from './picker-latency'

describe('picker latency summaries', () => {
  it('keeps unknown nodes distinct from failed tests', () => {
    expect(
      summarizePickerLatencies(['a', 'b'], {
        a: { id: 'a', alive: false, latencyMs: null, testedAt: '' },
      }),
    ).toEqual({ total: 2, measured: 1, alive: 0, fastest: undefined })
  })
  it('counts each matched node once and excludes results outside this subscription', () => {
    const a = { id: 'a', alive: true, latencyMs: 250, testedAt: '' }
    const b = { id: 'b', alive: true, latencyMs: 100, testedAt: '' }
    expect(
      summarizePickerLatencies(['a', 'a', 'b'], {
        a,
        b,
        other: { id: 'other', alive: true, latencyMs: 1, testedAt: '' },
      }),
    ).toEqual({ total: 2, measured: 2, alive: 2, fastest: b })
  })
  it('never selects failed, negative or non-finite values as the fastest result', () => {
    const bad = [
      { id: 'failed', alive: false, latencyMs: 1, testedAt: '' },
      { id: 'negative', alive: true, latencyMs: -1, testedAt: '' },
      { id: 'nan', alive: true, latencyMs: Number.NaN, testedAt: '' },
    ]
    const zero = { id: 'zero', alive: true, latencyMs: 0, testedAt: '' }
    const result = summarizePickerLatencies(
      [...bad.map((item) => item.id), 'zero'],
      Object.fromEntries([...bad, zero].map((item) => [item.id, item])),
    )
    expect(result).toEqual({ total: 4, measured: 4, alive: 1, fastest: zero })
  })
})
