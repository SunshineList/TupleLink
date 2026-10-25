import type { ConfigBackup } from './config-backup'
import { describe, expect, it } from 'vitest'
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  backupFileName,
  BackupFormatError,
  buildBackup,
  parseBackup,
  summariseBackup,
} from './config-backup'

const sample: ConfigBackup = {
  kind: BACKUP_KIND,
  version: BACKUP_VERSION,
  exportedAt: '2026-10-26T00:00:00.000Z',
  configs: [{ name: 'global', selected: true, global: { logLevel: 'info', tproxyPort: 12345, lanInterface: ['br-lan'] } }],
  routings: [{ name: 'default', selected: true, routing: 'pname(dnsmasq) -> must_direct' }],
  dnss: [{ name: 'default', selected: true, dns: 'upstream { 8.8.8.8 }', routing: { request: 'request { }', response: 'response { }' } }],
  groups: [
    {
      name: 'proxy',
      policy: 'min_moving_avg',
      policyParams: [{ key: 'tolerance', val: '50' }],
      nodeLinks: ['ss://YWVzLTI1Ni1nY206cGFzcw@1.2.3.4:8388#hk'],
      subscriptionLinks: ['https://example.com/sub'],
      subscriptionFilters: [null],
    },
  ],
}

describe('parseBackup', () => {
  it('round-trips a backup produced by buildBackup', () => {
    const parsed = parseBackup(JSON.stringify(buildBackup(sample)))
    expect(parsed.configs).toEqual(sample.configs)
    expect(parsed.routings).toEqual(sample.routings)
    expect(parsed.dnss).toEqual(sample.dnss)
    expect(parsed.groups).toEqual(sample.groups)
  })

  it('rejects files that are not ours', () => {
    expect(() => parseBackup('{}')).toThrow(BackupFormatError)
    expect(() => parseBackup('{"kind":"something-else","version":1}')).toThrow(/NaiLink/)
  })

  it('rejects broken JSON with a readable message', () => {
    expect(() => parseBackup('{')).toThrow(/JSON/)
  })

  it('refuses a backup written by a newer panel', () => {
    expect(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION + 1 }))).toThrow(/升级/)
  })

  it('keeps unknown global keys so a newer upstream field survives', () => {
    const parsed = parseBackup(
      JSON.stringify({
        kind: BACKUP_KIND,
        version: 1,
        configs: [{ name: 'global', selected: true, global: { futureOption: 'x' } }],
      }),
    )
    expect(parsed.configs[0].global).toHaveProperty('futureOption', 'x')
  })

  it('drops entries that cannot be replayed', () => {
    const parsed = parseBackup(
      JSON.stringify({
        kind: BACKUP_KIND,
        version: 1,
        routings: [{ name: 'empty', routing: '' }, { name: 'ok', routing: 'pname(a) -> direct' }],
        dnss: [{ name: 'empty', dns: '' }],
        groups: [{ policy: 'min_moving_avg' }, { name: '  ', policy: 'min_moving_avg' }, { name: 'kept' }],
      }),
    )
    expect(parsed.routings.map((routing) => routing.name)).toEqual(['ok'])
    expect(parsed.dnss).toEqual([])
    // 只有名字、没有策略参数和链接的组也要留：用户可能先建组再补节点。
    expect(parsed.groups.map((group) => group.name)).toEqual(['kept'])
  })

  it('tolerates missing sections', () => {
    const parsed = parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1 }))
    expect(parsed.configs).toEqual([])
    expect(parsed.routings).toEqual([])
    expect(parsed.dnss).toEqual([])
    expect(parsed.groups).toEqual([])
  })
})

describe('summariseBackup', () => {
  it('counts what the user is about to import', () => {
    expect(summariseBackup(sample)).toEqual({
      configs: 1,
      routings: 1,
      dnss: 1,
      groups: 1,
      nodes: 1,
      subscriptions: 1,
    })
  })
})

describe('backupFileName', () => {
  it('stamps the export date so repeated exports do not collide', () => {
    expect(backupFileName('2026-10-26T00:00:00.000Z')).toBe('nailink-config-2026-10-26.json')
  })

  it('falls back when the timestamp is unusable', () => {
    expect(backupFileName('')).toBe('nailink-config-backup.json')
  })
})
