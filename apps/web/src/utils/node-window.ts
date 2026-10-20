// Card plus its trailing gap. Touch layouts override the same value in CSS;
// NodeResource reads that value so virtual positions follow the visible cards.
export const NODE_ROW_HEIGHT = 102
export const NODE_OVERSCAN = 5

// A bounded window keeps both DOM size and drag measurements independent of the
// subscription size. The absolute indices remain the library's filtered indices.
export function nodeWindow(count: number, scrollTop: number, height: number, rowHeight = NODE_ROW_HEIGHT) {
  const first = Math.min(Math.max(0, Math.floor(scrollTop / rowHeight)), Math.max(0, count - 1))
  return {
    start: Math.max(0, first - NODE_OVERSCAN),
    end: Math.min(count, first + Math.ceil(Math.max(0, height) / rowHeight) + NODE_OVERSCAN + 1),
  }
}
