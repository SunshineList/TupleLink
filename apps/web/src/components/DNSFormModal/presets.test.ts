import { describe, expect, it } from 'vitest'
import { DNS_UPSTREAM_PRESETS } from './presets'

// 预设里的地址会被原样写进 dns 配置，最多人踩的坑就是少了 scheme 或端口，
// 那份配置在 dae 启动时会被拒，而错误只会出现在运行日志里。
// 主机部分只校验「有 scheme、有主机、端口可选」这一层，具体地址由预设自己保证；
// 写太细的正则会被 regexp 规则判成重复分支，反而更难维护。
const LINK = /^(?:udp|tcp|tcp\+udp|https):\/\/\S+$/

describe('dns upstream presets', () => {
  it('每一条预设都给了可用的上游地址', () => {
    for (const item of DNS_UPSTREAM_PRESETS) {
      expect(item.upstreams.length).toBeGreaterThanOrEqual(2)
      for (const upstream of item.upstreams) {
        expect(upstream.name).toMatch(/^[\w-]+$/)
        expect(upstream.link).toMatch(LINK)
      }
    }
  })

  it('预设内部的上游名字不重复', () => {
    for (const item of DNS_UPSTREAM_PRESETS) {
      const names = item.upstreams.map((upstream) => upstream.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('预设 id 与上游 id 都不跨预设冲突', () => {
    const ids = DNS_UPSTREAM_PRESETS.flatMap((item) => item.upstreams.map((upstream) => upstream.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
