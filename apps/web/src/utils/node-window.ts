export const NODE_ROW_HEIGHT = 76
export const NODE_OVERSCAN = 5

// A bounded window keeps both DOM size and drag measurements independent of the
// subscription size. The absolute indices remain the library's filtered indices.
export function nodeWindow(count: number, scrollTop: number, height: number) {
  const first = Math.min(Math.max(0, Math.floor(scrollTop / NODE_ROW_HEIGHT)), Math.max(0, count - 1))
  return {
    start: Math.max(0, first - NODE_OVERSCAN),
    end: Math.min(count, first + Math.ceil(Math.max(0, height) / NODE_ROW_HEIGHT) + NODE_OVERSCAN + 1),
  }
}
