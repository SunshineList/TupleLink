import { afterEach, describe, expect, it, vi } from 'vitest'
import { mixedDraft, mixedDraftChanged, mixedRuntimeTone, parseMixedSettings, saveMixedSettings } from './mixed-proxy'

const settings = {
  enabled: true,
  port: 7893,
  lan: true,
  host: '192.168.8.1',
  runtime: { state: 'port_in_use', address: '192.168.8.1:7893' },
}
afterEach(() => vi.unstubAllGlobals())
describe('mixed proxy saved configuration and runtime', () => {
  it('does not treat a saved enabled port as listening', () => {
    const result = parseMixedSettings(settings)
    expect(result.enabled).toBe(true)
    expect(result.runtime.state).toBe('port_in_use')
    expect(mixedRuntimeTone(result.runtime.state)).toBe('danger')
  })
  it('does not invent a running status for old or unknown runtimes', () => {
    expect(parseMixedSettings({ ...settings, runtime: undefined }).runtime.state).toBe('runtime_unavailable')
    expect(parseMixedSettings({ ...settings, runtime: { state: 'anything' } }).runtime.state).toBe(
      'runtime_unavailable',
    )
    expect(() => parseMixedSettings({})).toThrow('invalid_response')
  })
  it('retains a draft when a polling response changes the saved configuration', () => {
    const stored = parseMixedSettings(settings)
    const draft = { ...mixedDraft(stored), port: '7894' }
    expect(mixedDraftChanged(draft, { ...stored, port: 8000 })).toBe(true)
    expect(draft.port).toBe('7894')
  })
  it('requires readback to match before accepting a save', async () => {
    vi.stubGlobal('window', {
      parent: {
        L: {
          require: async () => ({
            declare: (spec: { method: string }) => async () =>
              spec.method === 'mixedsave' ? { success: true } : settings,
          }),
        },
      },
    })
    await expect(saveMixedSettings({ enabled: true, port: '7894', lan: true })).rejects.toThrow('state_failed')
    const result = await saveMixedSettings({ enabled: true, port: '7893', lan: true })
    expect(result.runtime.state).toBe('port_in_use')
  })
})
