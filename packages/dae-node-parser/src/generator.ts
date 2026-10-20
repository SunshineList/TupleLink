import type { GenerateHysteria2URLParams, GenerateURLParams, SSConfig } from './types'
import { Base64 } from 'js-base64'

export function formatURLHost(host: string): string {
  const value = host.trim()
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value
}

/** SIP002: AEAD-2022 uses percent-encoded plaintext userinfo. */
export function generateSSURL(data: SSConfig): string {
  const user = data.method.startsWith('2022-')
    ? `${encodeURIComponent(data.method)}:${encodeURIComponent(data.password)}`
    : Base64.encodeURI(`${data.method}:${data.password}`)
  let link = `ss://${user}@${formatURLHost(data.server)}:${data.port}/`
  if (data.plugin) {
    const plugin = [data.plugin as string]
    if (data.plugin === 'v2ray-plugin') {
      if (data.tls) plugin.push('tls')
      if (data.mode !== 'websocket') plugin.push(`mode=${data.mode}`)
      if (data.host) plugin.push(`host=${data.host}`)
      if (data.path) plugin.push(`path=${data.path.startsWith('/') ? data.path : `/${data.path}`}`)
    } else {
      plugin.push(`obfs=${data.obfs}`, `obfs-host=${data.host}`)
      if (data.obfs === 'http') plugin.push(`obfs-path=${data.path}`)
    }
    if (data.impl) plugin.push(`impl=${data.impl}`)
    link += `?plugin=${encodeURIComponent(plugin.join(';'))}`
  }
  return link + (data.name ? `#${encodeURIComponent(data.name)}` : '')
}

/**
 * Generate a URL from parameters
 */
export function generateURL({
  username,
  password,
  protocol,
  host,
  port,
  params,
  hash,
  path,
}: GenerateURLParams): string {
  // Build the URL manually to avoid external dependencies
  let url = `${protocol || 'http'}://`

  // Add auth if present
  if (username || password) {
    url += encodeURIComponent(username || '')

    if (password) {
      url += `:${encodeURIComponent(password)}`
    }

    url += '@'
  }

  // Add host and port
  url += formatURLHost(host || '')

  if (port) {
    url += `:${port}`
  }

  // Add path
  if (path) {
    url += path
  }

  // Add query params
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        searchParams.append(key, String(value))
      }
    }

    const queryString = searchParams.toString()

    if (queryString) {
      url += `?${queryString}`
    }
  }

  // Add hash
  if (hash) {
    url += `#${encodeURIComponent(hash)}`
  }

  return url
}

/**
 * Generate Hysteria2 URL
 */
export function generateHysteria2URL({ protocol, auth, host, port, params, hash }: GenerateHysteria2URLParams): string {
  // Encode the auth field to handle special characters like '@'
  const encodedAuth = encodeURIComponent(auth)
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const uri = new URL(`${protocol}://${encodedAuth}@${hostname}:${port}/`)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      uri.searchParams.append(key, String(value))
    }
  })

  if (hash) {
    uri.hash = encodeURIComponent(hash)
  }

  return uri.toString()
}

/**
 * Generate AnyTLS URL
 */
export function generateAnytlsURL({ protocol, auth, host, port, params, hash }: GenerateHysteria2URLParams): string {
  // Use Hysteria2 generator structure as they are similar
  return generateHysteria2URL({ protocol, auth, host, port, params, hash })
}
