import { describe, expect, it } from 'vitest'
import { groupColumnBase, groupColumnLocations } from './group-columns'

describe('group column ordering', () => {
  const offset = (id: string) => (id.includes('-column-1-') ? 3 : 0)
  it('keeps canonical, library and subscription browser IDs intact', () => {
    for (const id of ['group-nodes', 'group-subscriptions', 'node-list', 'subscription-test-nodes'])
      expect(groupColumnBase(id)).toBe(id)
    expect(groupColumnBase('group-column-1-subscriptions')).toBe('group-subscriptions')
  })
  it.each([
    ['group-nodes', 0, 'group-nodes', 2, 0, 2],
    ['group-column-1-nodes', 0, 'group-column-1-nodes', 1, 3, 4],
    ['group-nodes', 1, 'group-column-1-nodes', 0, 1, 3],
    ['group-column-1-nodes', 1, 'group-nodes', 0, 4, 0],
    ['group-column-1-nodes', 0, 'group-nodes', 3, 3, 2],
    ['node-list', 2, 'group-column-1-nodes', 0, 2, 3],
    ['group-nodes', 0, 'other-column-1-nodes', 1, 0, 4],
  ])('maps %s index %d to %s index %d', (source, index, target, targetIndex, from, to) => {
    const result = groupColumnLocations(
      { droppableId: source, index },
      { droppableId: target, index: targetIndex },
      offset,
    )
    expect(result.source.index).toBe(from)
    expect(result.destination?.index).toBe(to)
    expect(result.destination?.droppableId).toBe(groupColumnBase(target))
  })
  it('retains canceled drags without a destination', () => {
    expect(groupColumnLocations({ droppableId: 'group-column-1-subscriptions', index: 1 }, null, offset)).toEqual({
      source: { droppableId: 'group-subscriptions', index: 4 },
      destination: null,
    })
  })
})
