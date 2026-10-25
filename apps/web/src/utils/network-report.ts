/**
 * Reshape the router's network check into scannable rows.
 *
 * The script prints flat text: a few `key=value` lines, then `[Section]`
 * headers each followed by their own rows. Rendering it as one blob makes a
 * long report hard to navigate, so only the header lines are lifted out as
 * markers. Every other line is kept exactly as written — the report is evidence,
 * and reformatting a row would risk changing what it says.
 */

export interface NetworkSection {
  /** Section title without the surrounding brackets, empty before the first one. */
  title: string
  lines: string[]
}

export function parseNetworkReport(output: string): NetworkSection[] {
  const sections: NetworkSection[] = []
  let current: NetworkSection = { title: '', lines: [] }
  for (const line of output.split('\n')) {
    const header = /^\[(.+)\]$/.exec(line.trim())
    if (header) {
      if (current.lines.length || current.title) sections.push(current)
      current = { title: header[1], lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (current.lines.length || current.title) sections.push(current)
  // Blank lines separate sections in the source; the header already does that.
  for (const section of sections) {
    while (section.lines.length && !section.lines[0].trim()) section.lines.shift()
    while (section.lines.length && !section.lines.at(-1)?.trim()) section.lines.pop()
  }
  return sections.filter((section) => section.title || section.lines.some((line) => line.trim()))
}
