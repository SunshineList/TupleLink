import type { NodeLatencyProbeResult } from '~/apis'
import { describe, expect, it } from 'vitest'
import { mockNodes, mockSubscriptions } from '~/mocks/data'
import {
  buildNodeLibrary,
  defaultNodeFilters,
  filterNodeLibrary,
  orderNodeLibrary,
  reorderVisibleNodes,
} from './node-library'

describe('node library', () => {
  it('merges subscription nodes without losing manual edit permissions or duplicating IDs', () => {
    const nodes = mockNodes.nodes.edges
    const library = buildNodeLibrary(nodes, mockSubscriptions.subscriptions)
    expect(new Set(library.map((entry) => entry.node.id)).size).toBe(library.length)
    for (const node of nodes) expect(library.find((entry) => entry.node.id === node.id)?.editable).toBe(true)
    expect(library.length).toBeGreaterThanOrEqual(nodes.length)
  })
  it('keeps saved custom ordering, drops stale IDs and appends new nodes', () => {
    const library = buildNodeLibrary(mockNodes.nodes.edges, [])
    const ids = library.map((entry) => entry.node.id)
    expect(orderNodeLibrary(library, ['stale', ids[1], ids[1]]).map((entry) => entry.node.id)).toEqual([
      ids[1],
      ...ids.filter((id) => id !== ids[1]),
    ])
  })
  it('filters by source and never mutates the library when sorting measured latency', () => {
    const library = buildNodeLibrary(mockNodes.nodes.edges, mockSubscriptions.subscriptions)
    const ids = library.map((entry) => entry.node.id)
    const latencies: Record<string, NodeLatencyProbeResult> = {
      [ids[0]]: { id: ids[0], latencyMs: 0, alive: false, testedAt: '' },
      [ids[1]]: { id: ids[1], latencyMs: 15, alive: true, testedAt: '' },
    }
    expect(filterNodeLibrary(library, { ...defaultNodeFilters, sort: 'latency' }, latencies)[0].node.id).toBe(ids[1])
    expect(library.map((entry) => entry.node.id)).toEqual(ids)
    const source = mockSubscriptions.subscriptions[0].id
    const filtered = filterNodeLibrary(library, { ...defaultNodeFilters, source }, {})
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((entry) => entry.sources.some((item) => item.id === source))).toBe(true)
    expect(filterNodeLibrary(library, { ...defaultNodeFilters, search: 'missing-node-query' }, {})).toEqual([])
  })
  it('reorders filtered nodes without moving hidden entries', () => {
    expect(reorderVisibleNodes(['a', 'hidden', 'b', 'c'], ['a', 'b', 'c'], 2, 0)).toEqual(['c', 'hidden', 'a', 'b'])
    expect(reorderVisibleNodes(['a'], ['a'], 0, 4)).toEqual(['a'])
  })
})
