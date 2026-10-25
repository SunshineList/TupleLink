/**
 * Split the router's logrus text output into rows the panel can render.
 *
 * The daemon writes `time="…" level=… msg="…"` records, sometimes followed by
 * extra fields. A raw dump of that is hard to scan: every line repeats the same
 * three keys and the message is buried behind quotes. Parsing only reshapes what
 * is already on screen — nothing is dropped, and any line that does not match the
 * known shape is returned verbatim so unexpected output still shows up.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal' | 'unknown'

export interface LogLine {
  /** The line exactly as the daemon wrote it, kept for copying and for `raw` rows. */
  raw: string
  /** `HH:mm:ss` when the record carries a parseable timestamp, otherwise empty. */
  time: string
  level: LogLevel
  /** The `msg` value without its quotes, or the whole line when parsing failed. */
  message: string
  /** Trailing `key=value` fields other than time/level/msg, already unquoted. */
  fields: [string, string][]
}

const KNOWN_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warning', 'error', 'fatal']

// logrus writes `key=value` and quotes any value containing spaces, `"` or `=`.
// Values are read in one pass so a quoted message may itself contain `key=value`.
const FIELD = /([a-z_]\w*)=("(?:[^"\\]|\\.)*"|[^\s"]*)/gi

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return value
}

/** `2026-10-25T12:09:19Z` and `2026-10-25 12:09:19` both become `12:09:19`. */
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
  // Without a message the line is not a logrus record; show it untouched rather
  // than inventing structure that would misrepresent the output.
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
