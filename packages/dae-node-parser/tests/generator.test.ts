import type { SSConfig } from '../src/types'

import { describe, expect, it } from 'vitest'
import { generateAnytlsURL, generateHysteria2URL, generateSSURL, generateURL } from '../src/generator'
import { parseSSUrl } from '../src/parser'

const ss = {
  method: 'aes-128-gcm',
  password: 'p:@/?#% 中文',
  server: '2001:db8::1',
  port: 443,
  name: '香港 / #1',
  plugin: '',
} as SSConfig

it.each(['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305'] as const)(
  'generates SIP002 plaintext userinfo for %s and roundtrips special keys and IPv6',
  (method) => {
    const password = 'a+/=:second:key'
    const link = generateSSURL({ ...ss, method, password })
    expect(link).toContain(`ss://${method}:a%2B%2F%3D%3Asecond%3Akey@[2001:db8::1]:443/`)
    expect(parseSSUrl(link)).toMatchObject({ method, password, server: '[2001:db8::1]', port: 443, name: ss.name })
  },
)

it('roundtrips ordinary AEAD password delimiters using Base64URL', () => {
  expect(parseSSUrl(generateSSURL(ss))).toMatchObject({ password: ss.password, name: ss.name })
})

it.each(['2001:db8::1', '[2001:db8::1]'])('formats generic IPv6 host %s exactly once', (host) => {
  const link = generateURL({ protocol: 'tuic', host, port: 443, username: 'id', password: 'p:@/#%' })
  const parsed = new URL(link)
  expect(parsed.host).toBe('[2001:db8::1]:443')
  expect(decodeURIComponent(parsed.password)).toBe('p:@/#%')
})

describe.each([
  { protocol: 'hysteria2', generate: generateHysteria2URL },
  { protocol: 'anytls', generate: generateAnytlsURL },
])('$protocol node names', ({ protocol, generate }) => {
  it.each(['my-node', 'node / #1'])('preserves the encoded fragment for %s', (hash) => {
    const params = { protocol, auth: 'secret', host: 'example.com', port: 443, params: {}, hash }

    expect(new URL(generate(params)).hash).toBe(`#${encodeURIComponent(hash)}`)
  })
})
