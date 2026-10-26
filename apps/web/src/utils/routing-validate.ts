import { hasGeoIP, hasGeoSite } from './geodata-codes'

/**
 * 分流表里引用到、但数据文件里不存在的分类。
 *
 * dae 加载规则时，任一 geosite/geoip 查不到就整张表放弃
 * （ApplyRulesOptimizers error: code X not found），用户看到的现象是
 * 分流全部失效，而错误信息只提一个名字。所以在保存前先自己查一遍。
 */
export interface InvalidCode {
  kind: 'geosite' | 'geoip'
  code: string
}

const REFERENCE = /\b(geosite|geoip):([\w!-]+)/g

export function invalidCodes(source: string): InvalidCode[] {
  const found: InvalidCode[] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(REFERENCE)) {
    const kind = match[1] as InvalidCode['kind']
    const code = match[2]
    const key = `${kind}:${code.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const known = kind === 'geosite' ? hasGeoSite(code) : hasGeoIP(code)
    if (!known) found.push({ kind, code })
  }
  return found
}

/** 给提示文案用：geosite:ads、geoip:xx。 */
export function describeInvalidCode(item: InvalidCode): string {
  return `${item.kind}:${item.code}`
}
