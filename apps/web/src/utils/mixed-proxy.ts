export type MixedRuntimeState =
  | 'disabled'
  | 'service_stopped'
  | 'core_unavailable'
  | 'runtime_unavailable'
  | 'pending'
  | 'lan_unavailable'
  | 'invalid_port'
  | 'port_in_use'
  | 'bind_failed'
  | 'listener_failed'
  | 'listener_stopped'
  | 'listening'
  | 'core_starting'
export interface MixedProxySettings {
  enabled: boolean
  port: number
  lan: boolean
  host: string
  runtime: { state: MixedRuntimeState; address: string }
}
export interface MixedProxyDraft {
  enabled: boolean
  port: string
  lan: boolean
}
const states = new Set([
  'disabled',
  'service_stopped',
  'core_unavailable',
  'runtime_unavailable',
  'pending',
  'lan_unavailable',
  'invalid_port',
  'port_in_use',
  'bind_failed',
  'listener_failed',
  'listener_stopped',
  'listening',
  'core_starting',
])

async function rpc(method: 'mixed' | 'mixedsave', args: number[] = []) {
  const host = window.parent as Window & {
    L?: { require: (name: string) => Promise<{ declare: (spec: object) => (...args: number[]) => Promise<unknown> }> }
  }
  if (host === window || !host.L?.require) throw new Error('host_unavailable')
  const api = await host.L.require('rpc')
  return api.declare({
    object: 'daed-router',
    method,
    params: method === 'mixedsave' ? ['enabled', 'port', 'lan'] : [],
    expect: {},
    reject: true,
    raise: true,
  })(...args)
}
export function parseMixedSettings(result: unknown): MixedProxySettings {
  const value = result as Partial<MixedProxySettings> | undefined
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    typeof value.lan !== 'boolean' ||
    !Number.isInteger(value.port) ||
    typeof value.host !== 'string'
  )
    throw new Error('invalid_response')
  return {
    enabled: value.enabled,
    lan: value.lan,
    port: value.port!,
    host: value.host,
    runtime: {
      state: states.has(value.runtime?.state || '') ? value.runtime!.state : 'runtime_unavailable',
      address: typeof value.runtime?.address === 'string' ? value.runtime.address : '',
    },
  }
}
export const readMixedSettings = async () => parseMixedSettings(await rpc('mixed'))
export const mixedDraft = (saved: MixedProxySettings): MixedProxyDraft => ({
  enabled: saved.enabled,
  port: String(saved.port),
  lan: saved.lan,
})
export function mixedDraftChanged(draft: MixedProxyDraft, saved: MixedProxySettings) {
  return draft.enabled !== saved.enabled || draft.port !== String(saved.port) || draft.lan !== saved.lan
}
export async function saveMixedSettings(draft: MixedProxyDraft) {
  const result = (await rpc('mixedsave', [draft.enabled ? 1 : 0, Number(draft.port), draft.lan ? 1 : 0])) as
    | { success?: boolean; code?: string }
    | undefined
  if (!result?.success) throw new Error(result?.code || 'state_failed')
  const stored = await readMixedSettings()
  if (stored.enabled !== draft.enabled || stored.lan !== draft.lan || stored.port !== Number(draft.port))
    throw new Error('state_failed')
  return stored
}
export function mixedRuntimeTone(state: string) {
  return [
    'port_in_use',
    'lan_unavailable',
    'invalid_port',
    'bind_failed',
    'listener_failed',
    'listener_stopped',
  ].includes(state)
    ? 'danger'
    : state === 'listening'
      ? 'success'
      : 'info'
}
