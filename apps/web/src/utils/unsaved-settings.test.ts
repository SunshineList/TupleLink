import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindRouterNavigation } from './router-navigation'
import { confirmDiscardSettings, markSettingsDirty, unsavedSettingsAtom } from './unsaved-settings'

afterEach(() => {
  unsavedSettingsAtom.set([])
  vi.unstubAllGlobals()
})
describe('unsaved settings navigation protection', () => {
  it('tracks independent sections and removes only the section that saved', () => {
    markSettingsDirty('mixed', true)
    markSettingsDirty('notify', true)
    markSettingsDirty('mixed', false)
    expect(unsavedSettingsAtom.get()).toEqual(['notify'])
    vi.stubGlobal('window', { confirm: () => true })
    expect(confirmDiscardSettings()).toBe(true)
  })
  it('does not prompt for saved changes that still need Apply', () => {
    const confirm = vi.fn()
    vi.stubGlobal('window', { confirm })
    expect(confirmDiscardSettings()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('cancels a parent menu transition before changing its history, title or iframe', () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', { confirm })
    const current = 'https://router.test/cgi-bin/luci/admin/services/daed/advanced'
    const events = new Map<string, (event?: unknown) => void>()
    const host = {
      location: { href: current, reload: vi.fn() },
      history: {
        pushState: vi.fn((_a, _b, url) => {
          host.location.href = url
        }),
      },
      document: {
        title: '',
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: (name: string, fn: () => void) => events.set(name, fn),
        removeEventListener: vi.fn(),
      },
      addEventListener: (name: string, fn: () => void) => events.set(name, fn),
      removeEventListener: vi.fn(),
    }
    const navigate = vi.fn()
    const cleanup = bindRouterNavigation(host as unknown as Window, navigate)
    const title = host.document.title
    markSettingsDirty('mixed', true)
    const anchor = {
      getAttribute: () => '/cgi-bin/luci/admin/services/daed/logs',
      target: '',
      hasAttribute: () => false,
    }
    const event = {
      button: 0,
      target: { closest: () => anchor },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    }
    events.get('click')!(event)
    expect(host.history.pushState).not.toHaveBeenCalled()
    expect(host.document.title).toBe(title)
    expect(navigate).not.toHaveBeenCalled()
    // A cancelled parent Back action restores the accepted URL.
    host.location.href = current.replace('/advanced', '/logs')
    events.get('popstate')!()
    expect(host.location.href).toBe(current)
    expect(navigate).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    events.get('click')!(event)
    expect(navigate).toHaveBeenCalledWith('/logs')
    cleanup()
  })
})
