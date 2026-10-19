import { describe, expect, it } from 'vitest'
import { NODE_ROW_HEIGHT, nodeWindow } from './node-window'

describe('node window', () => {
  it('bounds rendered rows even for thousands of nodes and overscans both sides', () => {
    const range = nodeWindow(10_000, NODE_ROW_HEIGHT * 700, 456)
    expect(range).toEqual({ start: 695, end: 712 })
    expect(range.end - range.start).toBeLessThan(20)
  })
  it('uses taller touch rows to keep both virtual columns aligned while scrolling', () => {
    expect(nodeWindow(1000, 96 * 10, 480, 96)).toEqual({ start: 5, end: 21 })
  })
  it('handles empty lists, viewport resize and shrinkage after subscription updates', () => {
    expect(nodeWindow(0, 1000, 400)).toEqual({ start: 0, end: 0 })
    expect(nodeWindow(3, 100000, 400)).toEqual({ start: 0, end: 3 })
    expect(nodeWindow(100, -20, 76)).toEqual({ start: 0, end: 7 })
    expect(nodeWindow(100, 0, 456).end).toBeGreaterThan(nodeWindow(100, 0, 152).end)
  })
})
