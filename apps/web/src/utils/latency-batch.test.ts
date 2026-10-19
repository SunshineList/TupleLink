import { describe, expect, it } from 'vitest'
import { testLatencyBatches } from './latency-batch'

describe('bounded latency testing', () => {
  it('deduplicates IDs, uses concurrent single-node requests and reports each result', async () => {
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
    expect(batches).toHaveLength(79)
    expect(batches.every((batch) => batch.length === 1)).toBe(true)
    expect(batches.flat()).toHaveLength(79)
    expect(progress).toEqual(Array.from({ length: 79 }, (_, i) => i + 1))
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
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.length).toBeLessThan(20)
  })
  it('keeps eight workers moving while a slow node is pending, then drains in-flight work', async () => {
    let finish!: () => void
    const slow = new Promise<void>((resolve) => {
      finish = resolve
    })
    const completed: string[] = []
    let active = 0
    let peak = 0
    const task = testLatencyBatches(
      Array.from({ length: 12 }, (_, i) => String(i)),
      async ([id]) => {
        peak = Math.max(peak, ++active)
        if (id === '0') await slow
        await Promise.resolve()
        active--
        return [{ id, alive: true, latencyMs: 8, testedAt: '' }]
      },
      (results) => {
        completed.push(results[0].id)
      },
      () => false,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(peak).toBe(8)
    expect(completed).toHaveLength(11)
    expect(completed).not.toContain('0')
    finish()
    await task
    expect(completed.at(-1)).toBe('0')
    expect(active).toBe(0)
  })
})
