import type { RouterStatus } from './router-health'
import { describe, expect, it } from 'vitest'
import {
  attentionChecks,
  bootAction,
  bootState,
  formatPlatform,
  formatVersion,
  readChecks,
  serviceLevel,
  shouldOfferStart,
  summariseHealth,
} from './router-health'

// Mirrors the real payload from /usr/libexec/daed/check on iStoreOS 24.10.5.
const healthy: RouterStatus = {
  firmware: 'iStoreOS',
  release: '24.10.5',
  architecture: 'x86_64',
  kernel: '6.6.119',
  listen: '127.0.0.1:2023',
  compatible: true,
  running: false,
  enabled: true,
  autostart: true,
  version: '0.6.30-1',
  checks: [
    { name: 'system', status: 'ok', message: 'OpenWrt family firmware detected.' },
    { name: 'architecture', status: 'ok', message: 'x86_64' },
    { name: 'kernel_options', status: 'warning', message: 'Kernel config is unavailable.' },
    { name: 'other_openclash', status: 'warning', message: 'openclash is running.' },
  ],
}

describe('readChecks', () => {
  it('returns an empty list for a missing payload', () => {
    expect(readChecks(undefined)).toEqual([])
    expect(readChecks(null)).toEqual([])
    expect(readChecks({})).toEqual([])
  })

  it('drops entries without a usable name', () => {
    const status = {
      checks: [
        { name: 'system', status: 'ok', message: 'fine' },
        { status: 'ok', message: 'no name' },
        { name: '', status: 'ok', message: 'blank' },
      ],
    } as unknown as RouterStatus
    expect(readChecks(status).map((check) => check.name)).toEqual(['system'])
  })

  it('treats an unknown status as a warning instead of silently passing it', () => {
    const status = { checks: [{ name: 'btf', status: 'bogus', message: '' }] } as unknown as RouterStatus
    expect(readChecks(status)[0].status).toBe('warning')
  })
})

describe('summariseHealth', () => {
  it('counts each status and reports the worst one', () => {
    const health = summariseHealth(healthy)
    expect(health).toMatchObject({ level: 'warning', ok: 2, warning: 2, error: 0 })
    expect(health.blocking).toEqual([])
  })

  it('reports unknown when the router sent no checks', () => {
    expect(summariseHealth({}).level).toBe('unknown')
    expect(summariseHealth(undefined).level).toBe('unknown')
  })

  it('promotes any error to the blocking level', () => {
    const status: RouterStatus = {
      ...healthy,
      checks: [...healthy.checks!, { name: 'btf', status: 'error', message: 'BTF cannot be parsed' }],
    }
    const health = summariseHealth(status)
    expect(health.level).toBe('error')
    expect(health.blocking.map((check) => check.name)).toEqual(['btf'])
  })

  it('reports ok only when every check passed', () => {
    const status: RouterStatus = { checks: [{ name: 'system', status: 'ok', message: '' }] }
    expect(summariseHealth(status).level).toBe('ok')
  })
})

describe('attentionChecks', () => {
  it('hides passing checks and puts errors first', () => {
    const status: RouterStatus = {
      checks: [
        { name: 'system', status: 'ok', message: '' },
        { name: 'kernel_options', status: 'warning', message: '' },
        { name: 'btf', status: 'error', message: '' },
      ],
    }
    expect(attentionChecks(status).map((check) => check.name)).toEqual(['btf', 'kernel_options'])
  })

  it('is empty when everything passes', () => {
    const status: RouterStatus = { checks: [{ name: 'system', status: 'ok', message: '' }] }
    expect(attentionChecks(status)).toEqual([])
  })
})

describe('serviceLevel', () => {
  it('lets a blocking router error outrank a running service', () => {
    const status: RouterStatus = { running: true, checks: [{ name: 'btf', status: 'error', message: '' }] }
    expect(serviceLevel(status)).toBe('error')
  })

  it('reports ok when the service runs without blocking errors', () => {
    expect(serviceLevel({ ...healthy, running: true })).toBe('ok')
  })

  it('reports warning when the service is installed but stopped', () => {
    expect(serviceLevel(healthy)).toBe('warning')
  })
})

describe('formatVersion', () => {
  it('returns the installed package version', () => {
    expect(formatVersion(healthy)).toBe('0.6.30-1')
  })

  it('hides the placeholder daed-check prints for a half-removed install', () => {
    expect(formatVersion({ version: 'uninstalled' })).toBe('')
    expect(formatVersion({ version: '  ' })).toBe('')
    expect(formatVersion(undefined)).toBe('')
  })
})

describe('formatPlatform', () => {
  it('joins firmware and release', () => {
    expect(formatPlatform(healthy)).toBe('iStoreOS 24.10.5')
  })

  it('drops unknown parts', () => {
    expect(formatPlatform({ firmware: 'unknown', release: '24.10.5' })).toBe('24.10.5')
    expect(formatPlatform({})).toBe('')
  })
})

describe('shouldOfferStart', () => {
  it('offers start only for a compatible stopped service', () => {
    expect(shouldOfferStart(healthy)).toBe(true)
    expect(shouldOfferStart({ ...healthy, running: true })).toBe(false)
    expect(shouldOfferStart({ ...healthy, compatible: false })).toBe(false)
    expect(shouldOfferStart(undefined)).toBe(false)
  })
})

describe('bootState', () => {
  it('reads the init-script state, not the current daemon state', () => {
    // Stopping the proxy on a boot-enabled install leaves enabled=true and
    // autostart=true; the switch must still read as on.
    expect(bootState({ ...healthy, running: false, enabled: true, autostart: true })).toBe('enabled')
    expect(bootState({ ...healthy, running: true, enabled: false, autostart: false })).toBe('disabled')
  })

  it('does not infer the boot state from `enabled`', () => {
    expect(bootState({ enabled: true })).toBe('unknown')
    expect(bootState({ enabled: false })).toBe('unknown')
  })

  it('reports unknown when the payload is missing', () => {
    expect(bootState(undefined)).toBe('unknown')
    expect(bootState(null)).toBe('unknown')
  })
})

describe('bootAction', () => {
  it('sends the opposite of the current state', () => {
    expect(bootAction('enabled')).toBe('boot_disable')
    expect(bootAction('disabled')).toBe('boot_enable')
  })

  it('offers no action when the state is unknown', () => {
    expect(bootAction('unknown')).toBeNull()
  })
})
