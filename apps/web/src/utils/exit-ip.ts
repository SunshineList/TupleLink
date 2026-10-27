/**
 * 读取路由器的出口 IP。
 *
 * 解决的问题：面板上从来没有一处能回答「现在到底从哪出去」。
 * 家里一切正常、人从外面连回来却上不了网，或者某条分流规则看起来配好了
 * 却没生效——这两种情况都只能靠拿手机打开 ip.sb 去猜。
 *
 * 后端（/usr/libexec/daed/exit-ip）从两条路径各探一次：
 *   direct  显式绕过代理
 *   proxied 跟随系统路由，也就是日常上网的真实路径
 */

export interface ExitIPResult {
  /** 直连探测到的公网地址，失败时为空串。 */
  direct: string
  /** 跟随系统路径探测到的公网地址，失败时为空串。 */
  proxied: string
  /**
   * same    两个出口一致 —— 没走代理，或代理和直连恰好同一出口
   * different 出口不同，分流确实生效
   * unknown 至少一侧探测失败，不做判断
   */
  verdict: 'same' | 'different' | 'unknown'
}

/**
 * 通过 LuCI 的只读 RPC 读取。与日志页同一套会话，不额外开端口。
 *
 * 这个调用会主动发起外网请求，属于整个面板里唯一「有副作用」的只读接口，
 * 所以不给它自动轮询——由用户点一下才跑。
 */
export async function readExitIP(): Promise<ExitIPResult> {
  const host = window.parent as Window & {
    L?: { require: (name: string) => Promise<{ declare: (spec: object) => () => Promise<unknown> }> }
  }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  const rpc = await host.L.require('rpc')
  const result = (await rpc.declare({
    object: 'daed-router',
    method: 'exitip',
    expect: {},
    reject: true,
    raise: true,
  })()) as Partial<ExitIPResult> | undefined

  if (!result || typeof result !== 'object') throw new Error('exitip unavailable')
  return {
    direct: typeof result.direct === 'string' ? result.direct : '',
    proxied: typeof result.proxied === 'string' ? result.proxied : '',
    // 后端只会给这三个值，但旧版本可能没有这个字段，按 unknown 处理。
    verdict: result.verdict === 'same' || result.verdict === 'different' ? result.verdict : 'unknown',
  }
}

/** 出口不同才说明代理起作用了；两边都空时不要显示成「一致」。 */
export function proxyInEffect(result: ExitIPResult | undefined): boolean {
  if (!result) return false
  return result.verdict === 'different'
}

/**
 * 一条给界面直接用的结论。
 *
 * 刻意不说「分流生效 / 失效」这种肯定句：出口相同也可能是
 * 代理线路的落地 IP 与家宽恰好同城同段，面板没有归属地数据，
 * 不应该替用户下这种结论。
 */
export type ExitMessage = 'exitIP.unknown' | 'exitIP.different' | 'exitIP.same'

export function describeExit(result: ExitIPResult | undefined): ExitMessage {
  if (!result || result.verdict === 'unknown') return 'exitIP.unknown'
  return result.verdict === 'different' ? 'exitIP.different' : 'exitIP.same'
}
