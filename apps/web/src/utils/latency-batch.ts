import type { NodeLatencyProbeResult } from '~/apis'

// Each request stays below the CGI deadline; return results incrementally.
export async function testLatencyBatches(
  ids: string[],
  probe: (ids: string[]) => Promise<NodeLatencyProbeResult[]>,
  update: (results: NodeLatencyProbeResult[], completed: number, total: number) => void,
  stopped: () => boolean,
) {
  const unique = [...new Set(ids)]
  let completed = 0
  for (let start = 0; start < unique.length && !stopped(); start += 8) {
    const batch = unique.slice(start, start + 8)
    const results = await probe(batch)
    completed += batch.length
    update(results, completed, unique.length)
  }
}
