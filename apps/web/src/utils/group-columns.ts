import type { DraggableLocation } from '@hello-pangea/dnd'

export const groupColumnBase = (id: string) =>
  id.replace(/-column-1-(nodes|subscriptions)$/, '-$1').replace(/^node-list-column-1$/, 'node-list')

// Columns share one persisted order and retain a fixed halfway split after drop.
// Clamp a drop after the last left item so it stays in the left column.
export function groupColumnLocations(
  source: DraggableLocation,
  destination: DraggableLocation | null,
  offset: (id: string) => number,
) {
  const from = { droppableId: groupColumnBase(source.droppableId), index: source.index + offset(source.droppableId) }
  if (!destination) return { source: from, destination: null }
  const to = {
    droppableId: groupColumnBase(destination.droppableId),
    index: destination.index + offset(destination.droppableId),
  }
  if (from.droppableId === to.droppableId && offset(source.droppableId) > 0 && offset(destination.droppableId) === 0)
    to.index = Math.min(to.index, offset(source.droppableId) - 1)
  return { source: from, destination: to }
}
