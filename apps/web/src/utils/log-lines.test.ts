import { describe, expect, it } from 'vitest'
import { parseLogLine, parseLogLines } from './log-lines'

// Copied from /var/log/daed/daed.log on iStoreOS 24.10.5 (kernel 6.6.119).
const REAL_LOG = `time="2026-10-25T12:09:19Z" level=warning msg="so_mark_from_dae is unset; using internal socket mark 0x100 to prevent dae UDP self-capture"
time="2026-10-25T12:09:19Z" level=info msg="Falling back to veth device creation"
time="2026-10-25T12:09:19Z" level=info msg="Created veth device pair (kernel v6.6.119 does not support Netkit)"
time="2026-10-25T12:09:19Z" level=info msg=Ready`

describe('parseLogLine', () => {
  it('reads time, level and message from a real logrus record', () => {
    const line = parseLogLine(
      'time="2026-10-25T12:09:19Z" level=info msg="Created veth device pair (kernel v6.6.119 does not support Netkit)"',
    )
    expect(line).toEqual({
      raw: expect.any(String),
      time: '12:09:19',
      level: 'info',
      message: 'Created veth device pair (kernel v6.6.119 does not support Netkit)',
      fields: [],
    })
  })

  it('keeps an unquoted message', () => {
    expect(parseLogLine('time="2026-10-25T12:09:19Z" level=info msg=Ready').message).toBe('Ready')
  })

  it('does not split a message that itself contains key=value text', () => {
    const line = parseLogLine('level=info msg="routing match set len: 1/1024 set=direct"')
    expect(line.message).toBe('routing match set len: 1/1024 set=direct')
    expect(line.fields).toEqual([])
  })

  it('keeps extra fields out of the message', () => {
    const line = parseLogLine('time="2026-10-25T12:09:19Z" level=error msg="dial failed" outbound=proxy retries=3')
    expect(line.message).toBe('dial failed')
    expect(line.fields).toEqual([
      ['outbound', 'proxy'],
      ['retries', '3'],
    ])
  })

  it('unescapes quoted values', () => {
    expect(parseLogLine('level=info msg="say \\"hi\\" now"').message).toBe('say "hi" now')
  })

  it('treats an unrecognised level as unknown instead of dropping the line', () => {
    expect(parseLogLine('level=panic msg=boom').level).toBe('unknown')
  })

  it('returns non-logrus output verbatim', () => {
    expect(parseLogLine('Segmentation fault')).toEqual({
      raw: 'Segmentation fault',
      time: '',
      level: 'unknown',
      message: 'Segmentation fault',
      fields: [],
    })
  })

  it('returns a record without a msg field verbatim rather than inventing one', () => {
    const raw = 'level=info retries=3'
    expect(parseLogLine(raw)).toEqual({ raw, time: '', level: 'unknown', message: raw, fields: [] })
  })

  it('leaves the clock empty when the timestamp has no time of day', () => {
    expect(parseLogLine('time=startup level=info msg=Ready').time).toBe('')
  })

  it('accepts a space-separated timestamp', () => {
    expect(parseLogLine('time="2026-10-25 12:09:19" level=info msg=Ready').time).toBe('12:09:19')
  })
})

describe('parseLogLines', () => {
  it('parses every record of a real log tail', () => {
    const lines = parseLogLines(REAL_LOG)
    expect(lines).toHaveLength(4)
    expect(lines.map((line) => line.level)).toEqual(['warning', 'info', 'info', 'info'])
    expect(lines[0].message).toBe(
      'so_mark_from_dae is unset; using internal socket mark 0x100 to prevent dae UDP self-capture',
    )
    expect(lines[3].message).toBe('Ready')
  })

  it('drops blank lines but keeps everything else', () => {
    expect(parseLogLines('\n\nlevel=info msg=Ready\n\n')).toHaveLength(1)
  })

  it('returns an empty list for an empty log', () => {
    expect(parseLogLines('')).toEqual([])
    expect(parseLogLines('   \n  ')).toEqual([])
  })
})

describe('multi-line records', () => {
  // dae 把候选列表写在 msg 的引号里，一条记录能占 50 行。
  const list = [
    'time="Oct 25 18:28:24" level=info msg="Group \'proxy\' [tcp4]:',
    '   1. [] hk01: 141ms',
    '   2. [] jp02: 260ms"',
    'time="Oct 25 18:28:25" level=warning msg="Marking dialer as unavailable"',
  ].join('\n')

  it('把引号内的续行并回同一条记录', () => {
    const lines = parseLogLines(list)
    expect(lines).toHaveLength(2)
    expect(lines[0].message).toBe("Group 'proxy' [tcp4]:")
    expect(lines[0].detail).toEqual(['   1. [] hk01: 141ms', '   2. [] jp02: 260ms'])
    expect(lines[1].level).toBe('warning')
  })

  it('没有续行的记录不带 detail', () => {
    expect(parseLogLines(list)[1].detail).toBeUndefined()
  })

  it('引号闭合后紧跟的新记录不会被吞掉', () => {
    const lines = parseLogLines('time="t" level=info msg="a"\ntime="t" level=error msg="b"')
    expect(lines.map((line) => line.message)).toEqual(['a', 'b'])
  })

  it('转义引号不会误判记录边界', () => {
    const lines = parseLogLines('time="t" level=info msg="say \\"hi\\" now"\ntime="t" level=info msg="next"')
    expect(lines).toHaveLength(2)
    expect(lines[0].message).toBe('say "hi" now')
  })

  it('不是记录开头的孤立行仍然单独出现', () => {
    const lines = parseLogLines('panic: something bad\ntime="t" level=info msg="ok"')
    expect(lines).toHaveLength(2)
    expect(lines[0].level).toBe('unknown')
  })
})
