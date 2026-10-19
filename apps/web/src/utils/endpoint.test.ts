import { describe, expect, it } from 'vitest'

import { defaultEndpointURL } from './endpoint'

describe('dashboard endpoint', () => {
  it('uses the serving port in a router installation', () => {
    expect(
      defaultEndpointURL({ origin: 'http://192.168.8.1:9080', protocol: 'http:', hostname: '192.168.8.1' }, false),
    ).toBe('http://192.168.8.1:9080/graphql')
  })

  it('preserves HTTPS and bracketed IPv6 addresses', () => {
    expect(
      defaultEndpointURL({ origin: 'https://[fd00::1]:8443', protocol: 'https:', hostname: '[fd00::1]' }, false),
    ).toBe('https://[fd00::1]:8443/graphql')
  })

  it('keeps the separate backend port during development', () => {
    expect(
      defaultEndpointURL({ origin: 'http://localhost:5173', protocol: 'http:', hostname: 'localhost' }, true),
    ).toBe('http://localhost:2023/graphql')
  })
})
