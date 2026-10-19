import type { RouterMenuHost } from './router-menu'
import { describe, expect, it, vi } from 'vitest'
import { refreshStaleRouterMenu } from './router-menu'

function fixture(names = ['dashboard', 'logs']) {
  const storage = new Map([['unrelated-preference', 'keep']])
  const flushCache = vi.fn()
  const reload = vi.fn()
  const host: RouterMenuHost = {
    L: {
      require: vi.fn(async () => ({
        menu: {
          load: async () => ({
            children: {
              admin: {
                children: {
                  services: {
                    children: {
                      daed: {
                        children: Object.fromEntries(names.map((name) => [name, {}])),
                      },
                    },
                  },
                },
              },
            },
          }),
          flushCache,
        },
      })),
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value)
      },
    },
    location: { reload },
  }
  return { host, storage, flushCache, reload }
}

describe('luCI browser menu upgrade', () => {
  it('clears only a stale menu and refreshes the parent once without changing other preferences', async () => {
    const { host, storage, flushCache, reload } = fixture()
    expect(await refreshStaleRouterMenu(host)).toBe(true)
    expect(flushCache).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(storage.get('unrelated-preference')).toBe('keep')
    expect(await refreshStaleRouterMenu(host)).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })
  it('leaves the current four-page menu intact', async () => {
    const { host, flushCache, reload } = fixture(['dashboard', 'resources', 'advanced', 'logs'])
    expect(await refreshStaleRouterMenu(host)).toBe(false)
    expect(flushCache).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
  it('does not reload direct panels or break unsupported LuCI variants', async () => {
    const { host, reload } = fixture()
    delete host.L
    expect(await refreshStaleRouterMenu(host)).toBe(false)
    host.L = {
      require: async () => {
        throw new Error('unavailable')
      },
    }
    expect(await refreshStaleRouterMenu(host)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
  it('does not try to reconstruct menus absent from a restricted account', async () => {
    const { host, reload } = fixture()
    host.L = { require: async () => ({ menu: { load: async () => ({}), flushCache: vi.fn() } }) }
    expect(await refreshStaleRouterMenu(host)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
