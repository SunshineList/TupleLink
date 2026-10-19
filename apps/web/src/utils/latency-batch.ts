import type { NodeLatencyProbeResult } from '~/apis'

// A sliding window avoids a slow node holding up the next seven results.
export async function testLatencyBatches(
  ids: string[],
  probe: (ids: string[]) => Promise<NodeLatencyProbeResult[]>,
  update: (results: NodeLatencyProbeResult[], completed: number, total: number) => void,
  stopped: () => boolean,
) {
  const unique = [...new Set(ids)]
  let completed = 0
  let next = 0
  let failure: unknown
  await Promise.all(
    Array.from({ length: Math.min(8, unique.length) }, async () => {
      while (next < unique.length && !stopped() && !failure) {
        const id = unique[next++]
        try {
          const results = await probe([id])
          update(results, ++completed, unique.length)
        } catch (error) {
          failure = error
        }
      }
    }),
  )
  // Wait for all in-flight requests before enabling another test.
  if (failure) throw failure
}
