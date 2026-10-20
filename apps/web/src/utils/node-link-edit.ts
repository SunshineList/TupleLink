import { Base64 } from 'js-base64'

const aliases = [
  ['insecure', 'allowInsecure', 'allow_insecure', 'allowinsecure', 'skipVerify'],
  ['sni', 'peer', 'serverName'],
  ['obfs-password', 'obfsPassword'],
  ['ports', 'mport'],
  ['path', 'serviceName', 'seed'],
]

// Compare against the form's initial serialization, not the original URI:
// unchanged defaults must not overwrite omitted options or provider extensions.
function mergeParams(original: URLSearchParams, baseline: URLSearchParams, edited: URLSearchParams) {
  const keys = new Set([...original.keys(), ...baseline.keys(), ...edited.keys()])
  const groups = [
    ...aliases,
    ...[...keys].filter((key) => !aliases.some((group) => group.includes(key))).map((key) => [key]),
  ]
  for (const group of groups) {
    const values = (params: URLSearchParams) => group.flatMap((key) => params.getAll(key).map((value) => [key, value]))
    if (JSON.stringify(values(baseline)) === JSON.stringify(values(edited))) {
      for (const key of group) edited.delete(key)
      for (const [key, value] of values(original)) edited.append(key, value)
    }
  }
}

function mergePlugin(original: string, baseline: string, edited: string): string {
  const [oldID, ...oldOptions] = original.split(';')
  const [initialID, ...initialOptions] = baseline.split(';')
  const [newID, ...newOptions] = edited.split(';')
  if (!newID || oldID !== newID || initialID !== newID) return edited
  const parse = (options: string[]) =>
    new URLSearchParams(
      options.map((part) => {
        const index = part.indexOf('=')
        return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)]
      }),
    )
  const result = parse(newOptions)
  mergeParams(parse(oldOptions), parse(initialOptions), result)
  return [newID, ...[...result].map(([key, value]) => (value ? `${key}=${value}` : key))].join(';')
}

/** Preserve unedited URI/VMess fields without storing credentials outside the node. */
export function preserveNodeLink(original: string, baseline: string, edited: string): string {
  if (edited === baseline) return original
  const scheme = (value: string) => value.slice(0, value.indexOf('://')).replace(/^hy2$/, 'hysteria2')
  if (scheme(original) !== scheme(edited)) return edited
  if (original.startsWith('vmess://')) {
    // The standard URI import is converted by the existing form into legacy
    // JSON; its original content is not a Base64 JSON object.
    if (original.includes('@')) return edited
    const parse = (value: string) => JSON.parse(Base64.decode(value.slice(8))) as Record<string, unknown>
    const old = parse(original)
    const initial = parse(baseline)
    const result = parse(edited)
    for (const key of new Set([...Object.keys(old), ...Object.keys(initial), ...Object.keys(result)])) {
      if (JSON.stringify(initial[key]) === JSON.stringify(result[key])) {
        if (Object.hasOwn(old, key)) result[key] = old[key]
        else delete result[key]
      }
    }
    return `vmess://${Base64.encode(JSON.stringify(result))}`
  }
  // SSR has its own nested Base64 format; never treat it as a standard URL.
  if (original.startsWith('ssr://')) return edited
  if (original.startsWith('ss://') && !original.includes('@')) return edited
  const old = new URL(original)
  const initial = new URL(baseline)
  const result = new URL(edited)
  if (
    old.searchParams.has('plugin') &&
    result.searchParams.has('plugin') &&
    initial.searchParams.get('plugin') !== result.searchParams.get('plugin')
  ) {
    result.searchParams.set(
      'plugin',
      mergePlugin(
        old.searchParams.get('plugin')!,
        initial.searchParams.get('plugin') || '',
        result.searchParams.get('plugin') || '',
      ),
    )
  }
  mergeParams(old.searchParams, initial.searchParams, result.searchParams)
  return result.toString()
}
