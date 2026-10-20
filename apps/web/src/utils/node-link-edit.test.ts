import { Base64 } from 'js-base64'
import { preserveNodeLink } from './node-link-edit'

it('keeps unedited VLESS options, omitted defaults and repeated provider extensions', () => {
  const original = 'vless://id@server:443?type=ws&path=%2Fws&packetEncoding=xudp&extra=a&extra=b#old'
  const baseline = 'vless://id@server:443?type=ws&path=%2Fws&security=none&allowInsecure=false#old'
  const edited = baseline.replace('#old', '#new')
  const result = new URL(preserveNodeLink(original, baseline, edited))
  expect(result.hash).toBe('#new')
  expect(result.searchParams.getAll('extra')).toEqual(['a', 'b'])
  expect(result.searchParams.get('packetEncoding')).toBe('xudp')
  expect(result.searchParams.has('security')).toBe(false)
  expect(result.searchParams.has('allowInsecure')).toBe(false)
})

it('replaces all original TLS and port aliases when those fields are edited', () => {
  const original = 'hy2://secret@server:443?allowInsecure=1&mport=5000-5002&obfsPassword=old&custom=%2B%26'
  const baseline = 'hysteria2://secret@server:443?insecure=1&ports=5000-5002&obfs-password=old'
  const edited = 'hysteria2://secret@server:443?insecure=0&obfs-password=new'
  const result = new URL(preserveNodeLink(original, baseline, edited))
  expect([...result.searchParams]).toEqual([
    ['insecure', '0'],
    ['obfs-password', 'new'],
    ['custom', '+&'],
  ])
})

it('preserves unsupported SS plugin options while editing its known host', () => {
  const original = `ss://userinfo@server:443/?plugin=${encodeURIComponent('v2ray-plugin;tls;host=old;custom=a=b')}`
  const baseline = original.replace(encodeURIComponent(';custom=a=b'), '')
  const result = new URL(preserveNodeLink(original, baseline, baseline.replace('host%3Dold', 'host%3Dnew')))
  expect(result.searchParams.get('plugin')!.split(';').sort()).toEqual(
    ['v2ray-plugin', 'tls', 'host=new', 'custom=a=b'].sort(),
  )
  expect(new URL(preserveNodeLink(original, baseline, 'ss://userinfo@server:443/')).searchParams.has('plugin')).toBe(
    false,
  )
})

it('does not add another protocol options when switching protocol', () => {
  expect(preserveNodeLink('anytls://p@a:443?custom=1', 'anytls://p@a:443?insecure=0', 'vless://id@a:443')).toBe(
    'vless://id@a:443',
  )
})

it('preserves VMess JSON extensions and omitted defaults when changing credentials', () => {
  const uri = (body: object) => `vmess://${Base64.encode(JSON.stringify(body))}`
  const original = { add: 'server', id: 'old', custom: { a: 'b' } }
  const baseline = { ...original, scy: 'auto', custom: undefined }
  const result = preserveNodeLink(uri(original), uri(baseline), uri({ ...baseline, id: 'new' }))
  expect(JSON.parse(Base64.decode(result.slice(8)))).toEqual({ ...original, id: 'new' })
})

it('keeps the exact original link when only the separate node label changes', () => {
  expect(preserveNodeLink('ss://legacy#old', 'ss://normalized#old', 'ss://normalized#old')).toBe('ss://legacy#old')
})

it('replaces every supported legacy TLS alias when enabling certificate checks', () => {
  const original = 'tuic://id:p@server:443?skipVerify=true&allowinsecure=1&custom=1'
  const baseline = 'tuic://id:p@server:443?allow_insecure=true'
  const result = new URL(preserveNodeLink(original, baseline, baseline.replace('true', 'false')))
  expect([...result.searchParams]).toEqual([
    ['allow_insecure', 'false'],
    ['custom', '1'],
  ])
})

it('does not try to decode a standard VMess URI as Base64 JSON', () => {
  const edited = `vmess://${Base64.encode(JSON.stringify({ id: 'new' }))}`
  expect(preserveNodeLink('vmess://id@server:443', 'vmess://initial', edited)).toBe(edited)
})
