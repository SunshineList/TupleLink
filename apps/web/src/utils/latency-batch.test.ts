import { describe, expect, it } from 'vitest'
import { testLatencyBatches } from './latency-batch'

describe('bounded latency testing', () => {
  it('deduplicates IDs, uses eight-node batches and reports incremental progress', async () => {
    const batches: string[][] = []
    const progress: number[] = []
    await testLatencyBatches(
      [...Array.from({ length: 79 }, (_, i) => String(i)), '0'],
      async (ids) => {
        batches.push(ids)
        return ids.map((id) => ({ id, alive: true, latencyMs: 8, testedAt: '' }))
      },
      (_, count, total) => {
        expect(total).toBe(79)
        progress.push(count)
      },
      () => false,
    )
    expect(batches).toHaveLength(10)
    expect(batches.every((batch) => batch.length <= 8)).toBe(true)
    expect(batches.flat()).toHaveLength(79)
    expect(progress).toEqual([8, 16, 24, 32, 40, 48, 56, 64, 72, 79])
  })
  it('stops between batches and never submits an empty request', async () => {
    let calls = 0
    await testLatencyBatches(
      Array.from({ length: 100 }, (_, i) => String(i)),
      async () => {
        calls++
        return []
      },
      () => {},
      () => calls > 0,
    )
    expect(calls).toBe(1)
    await testLatencyBatches(
      [],
      async () => {
        calls++
        return []
      },
      () => {},
      () => false,
    )
    expect(calls).toBe(1)
  })
  it('retains completed batches and propagates transport failures without marking remaining nodes dead', async () => {
    const progress: number[] = []
    await expect(
      testLatencyBatches(
        Array.from({ length: 20 }, (_, i) => String(i)),
        async (ids) => {
          if (ids[0] === '8') throw new Error('HTTP 502')
          return ids.map((id) => ({ id, alive: false, testedAt: '' }))
        },
        (_, count) => progress.push(count),
        () => false,
      ),
    ).rejects.toThrow('HTTP 502')
    expect(progress).toEqual([8])
  })
})
