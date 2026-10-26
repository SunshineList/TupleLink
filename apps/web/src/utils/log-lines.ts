/**
 * 把路由器侧 logrus 的文本输出拆成面板可渲染的行。
 *
 * 守护进程写的是 `time="…" level=… msg="…"` 格式，偶尔带额外字段。
 * 原始转储很难读：每行重复同样三个 key，消息埋在引号后面。
 * 解析只重排已有的内容 —— 不丢弃任何东西，
 * 任何不符合已知格式的行原样返回，让意外输出也能出现。
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal' | 'unknown'

export interface LogLine {
  /** 守护进程写下的原始行，保留用于复制和 `raw` 视图。 */
  raw: string
  /** 记录里有可解析时间戳时取 `HH:mm:ss`，否则为空字符串。 */
  time: string
  level: LogLevel
  /** 去掉引号的 `msg` 值；解析失败时退回整行。多行 msg 只保留首行。 */
  message: string
  /** 除 time/level/msg 之外的尾部 `key=value` 字段，已去掉引号。 */
  fields: [string, string][]
  /**
   * 多行 msg 的后续行。dae 把候选列表整段塞进 msg 的引号里，
   * 这些行不是独立记录，折叠后才有可读性。
   */
  detail?: string[]
}

const KNOWN_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warning', 'error', 'fatal']

// logrus 写 `key=value`，值里含空格、`"` 或 `=` 时加引号。
// 一遍读完所有字段，这样带引号的消息本身也可以包含 `key=value`。
const FIELD = /([a-z_]\w*)=("(?:[^"\\]|\\.)*"|[^\s"]*)/gi

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return value
}

/** `2026-10-25T12:09:19Z` 和 `2026-10-25 12:09:19` 都变成 `12:09:19`。 */
function clockOf(stamp: string): string {
  const match = /(\d{2}):(\d{2}):(\d{2})/.exec(stamp)
  return match ? `${match[1]}:${match[2]}:${match[3]}` : ''
}

function levelOf(value: string): LogLevel {
  const lower = value.toLowerCase()
  return (KNOWN_LEVELS as string[]).includes(lower) ? (lower as LogLevel) : 'unknown'
}

export function parseLogLine(raw: string): LogLine {
  const fields: [string, string][] = []
  for (const match of raw.matchAll(FIELD)) {
    fields.push([match[1], unquote(match[2])])
  }
  if (fields.length === 0) {
    return { raw, time: '', level: 'unknown', message: raw, fields: [] }
  }

  const lookup = new Map(fields)
  const message = lookup.get('msg')
  // 没有 msg 说明这行不是 logrus 记录；原样展示，
  // 不要凭空构造会误述输出的结构。
  if (message === undefined) {
    return { raw, time: '', level: 'unknown', message: raw, fields: [] }
  }

  const time = lookup.has('time') ? clockOf(lookup.get('time')!) : ''
  // msg 值里带换行时拆成首行 + 续行：列表本身是数据，不是消息正文。
  const [head, ...rest] = message.split('\n')
  const detail = rest.filter((line) => line.trim().length > 0)
  return {
    raw,
    time,
    level: lookup.has('level') ? levelOf(lookup.get('level')!) : 'unknown',
    message: head.trim(),
    fields: fields.filter(([key]) => key !== 'time' && key !== 'level' && key !== 'msg'),
    ...(detail.length ? { detail } : {}),
  }
}

/** 一行是不是新记录的开头。logrus 用 `time=`，个别组件用 `{` 或 `[level]`。 */
const RECORD_START = /^(?:time=|\{|\[(?:trace|debug|info|warn|warning|error|fatal|panic)\])/i

/** 未转义的双引号是否已成对。logrus 的 msg 值可以跨行，闭合前都算同一条记录。 */
function balanced(text: string): boolean {
  let count = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"' && text[index - 1] !== '\\') count++
  }
  return count % 2 === 0
}

/**
 * 把物理行合并回逻辑记录。
 *
 * dae 的候选列表写在 `msg="…"` 的引号里，一条记录能占 50 行。按 `\n` 直接切会
 * 把一条记录拆成 50 条假日志（首行带 level，后面 49 行是 unknown）。这里以引号
 * 是否闭合判断记录边界，无法归因的孤立行仍然各自成条，不静默吞掉。
 */
function joinRecords(text: string): string[] {
  const records: string[] = []
  let current: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const startsNew = RECORD_START.test(line)
    if (startsNew && (current.length === 0 || balanced(current.join('\n')))) {
      if (current.length) records.push(current.join('\n'))
      current = [line]
      continue
    }
    if (current.length) {
      current.push(line)
      continue
    }
    // 首行就不是记录开头：保留为独立记录，让异常输出也能出现。
    records.push(line)
  }
  if (current.length) records.push(current.join('\n'))
  return records
}

export function parseLogLines(text: string): LogLine[] {
  return joinRecords(text).map(parseLogLine)
}
