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
  /** 去掉引号的 `msg` 值；解析失败时退回整行。 */
  message: string
  /** 除 time/level/msg 之外的尾部 `key=value` 字段，已去掉引号。 */
  fields: [string, string][]
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
  return {
    raw,
    time,
    level: lookup.has('level') ? levelOf(lookup.get('level')!) : 'unknown',
    message,
    fields: fields.filter(([key]) => key !== 'time' && key !== 'level' && key !== 'msg'),
  }
}

export function parseLogLines(text: string): LogLine[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(parseLogLine)
}
