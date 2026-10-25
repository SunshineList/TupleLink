import { describe, expect, it } from 'vitest'
import { parseNetworkReport } from './network-report'

// Trimmed from a real run on iStoreOS 24.10.5 (kernel 6.6.119).
const REAL_REPORT = `NaiLink network check v2 (configuration read-only)
traffic_owner=unknown; HTTPS success tests the current path, not NaiLink specifically.
time=2026-10-25T22:40:06+08:00

[Logical interfaces and actual devices]
network=lan up=true device=br-lan
network=wan up=unknown device=unknown

[Default routes]
default via 192.168.5.1 dev br-lan proto static 

[Google DNS through the local resolver; 6 seconds maximum]
Server:		127.0.0.1
Address:	127.0.0.1:53
`

describe('parseNetworkReport', () => {
  it('lifts section titles out of a real report', () => {
    const sections = parseNetworkReport(REAL_REPORT)
    expect(sections.map((section) => section.title)).toEqual([
      '',
      'Logical interfaces and actual devices',
      'Default routes',
      'Google DNS through the local resolver; 6 seconds maximum',
    ])
  })

  it('keeps the preamble in an untitled first section', () => {
    const [first] = parseNetworkReport(REAL_REPORT)
    expect(first.lines).toContain('traffic_owner=unknown; HTTPS success tests the current path, not NaiLink specifically.')
  })

  it('keeps every row exactly as written', () => {
    const sections = parseNetworkReport(REAL_REPORT)
    expect(sections[1].lines).toEqual(['network=lan up=true device=br-lan', 'network=wan up=unknown device=unknown'])
    // Tabs inside the resolver answer must survive untouched.
    expect(sections[3].lines).toContain('Server:\t\t127.0.0.1')
  })

  it('drops the trailing newline artifact but not a blank line between rows', () => {
    const sections = parseNetworkReport('[A]\none\n\n\ntwo\n')
    expect(sections).toEqual([{ title: 'A', lines: ['one', '', '', 'two'] }])
  })

  it('does not treat a bracketed log line as a section', () => {
    const sections = parseNetworkReport('[A]\nmsg="[warn] dial failed"\n')
    expect(sections).toHaveLength(1)
    expect(sections[0].lines).toEqual(['msg="[warn] dial failed"'])
  })

  it('ignores an empty report', () => {
    expect(parseNetworkReport('')).toEqual([])
    expect(parseNetworkReport('\n\n')).toEqual([])
  })

  it('keeps a header that has no rows yet', () => {
    expect(parseNetworkReport('[A]\n')).toEqual([{ title: 'A', lines: [] }])
  })
})
