import type { Upstream } from './types'

// 评论里最多的一句是「DNS 里的 223.5.5.5、8.8.8.8 到底该填哪个」。
// 这些预设只是把常见组合一次填好，用户仍要自己点保存，
// 所以不是「一键改配置」，只是省掉查文档那一步。

export type DNSUpstreamPresetId = 'cn-direct' | 'plain' | 'doh' | 'ipv6'

export interface DNSUpstreamPreset {
  id: DNSUpstreamPresetId
  // i18n 的键是字面量联合类型，这里必须写全，否则 t() 不接受任意字符串。
  labelKey:
    | 'dnsConfig.presets.cn-direct.label'
    | 'dnsConfig.presets.plain.label'
    | 'dnsConfig.presets.doh.label'
    | 'dnsConfig.presets.ipv6.label'
  hintKey:
    | 'dnsConfig.presets.cn-direct.hint'
    | 'dnsConfig.presets.plain.hint'
    | 'dnsConfig.presets.doh.hint'
    | 'dnsConfig.presets.ipv6.hint'
  upstreams: Upstream[]
}

const preset = (
  id: DNSUpstreamPresetId,
  upstreams: Array<[string, string]>,
): DNSUpstreamPreset => ({
  id,
  labelKey: `dnsConfig.presets.${id}.label` as DNSUpstreamPreset['labelKey'],
  hintKey: `dnsConfig.presets.${id}.hint` as DNSUpstreamPreset['hintKey'],
  upstreams: upstreams.map(([name, link]) => ({ id: `${id}-${name}`, name, link })),
})

export const DNS_UPSTREAM_PRESETS: DNSUpstreamPreset[] = [
  // 国内运营商 DNS 直连 + 境外走加密 DNS，最省事也最不容易踩 DNS 污染的搭配。
  preset('cn-direct', [
    ['alidns', "udp://223.5.5.5:53"],
    ['googledns', "tcp+udp://8.8.8.8:53"],
  ]),
  preset('plain', [
    ['cloudflare', "udp://1.1.1.1:53"],
    ['googledns', "tcp+udp://8.8.8.8:53"],
  ]),
  // 运营商屏蔽 53 端口或在公共 WiFi 下被劫持时，DoH 是唯一稳定的路。
  preset('doh', [
    ['alidns', "https://dns.alidns.com/dns-query"],
    ['cloudflare', "https://1.1.1.1/dns-query"],
  ]),
  // 纯 IPv6 出口的机器只有走到 v6 的解析器才不会再报 EAI_AGAIN。
  preset('ipv6', [
    ['alidns6', "udp://[2400:3200::1]:53"],
    ['googledns6', "tcp+udp://[2001:4860:4860::8888]:53"],
  ]),
]
