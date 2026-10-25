/**
 * 把路由器侧的网络检查输出整理成便于浏览的行段。
 *
 * 脚本本身输出的是扁平文本：若干 `key=value` 行，然后每个 `[Section]` 标题后跟自己的行。
 * 整坨渲染会让长报告很难导航，所以这里只把标题行抽出来当标记。
 * 其他每一行都按原样保留 —— 这份报告是证据，
 * 重排一行就有改语义的风险。
 */

export interface NetworkSection {
  /** 不含方括号的段标题；在遇到第一个段之前为空字符串。 */
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
  // 源文本里空行分隔各段；这里标题已经做了分段，所以前后空行直接剪掉。
  for (const section of sections) {
    while (section.lines.length && !section.lines[0].trim()) section.lines.shift()
    while (section.lines.length && !section.lines.at(-1)?.trim()) section.lines.pop()
  }
  return sections.filter((section) => section.title || section.lines.some((line) => line.trim()))
}
