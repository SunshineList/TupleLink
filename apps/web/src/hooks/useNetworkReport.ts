import { useMutation } from '@tanstack/react-query'

interface LuCIRpc {
  declare: (spec: object) => (params?: object) => Promise<unknown>
}

export interface NetworkReport {
  output: string
  truncated?: boolean
  note?: string
}

// 检查只按需运行：它会通过当前活跃的数据通路开 HTTPS 连接，
// 所以轮询它会产生用户没有要求的流量。
// 路由器侧把单次运行上限设为 45s，响应上限设为 32 KiB。
async function readNetworkReport(): Promise<NetworkReport> {
  const host = window.parent as Window & { L?: { require: (name: string) => Promise<LuCIRpc> } }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  const rpc = await host.L.require('rpc')
  const result = (await rpc.declare({ object: 'daed-router', method: 'network', expect: {} })()) as
    | NetworkReport
    | undefined
  if (typeof result?.output !== 'string') throw new Error('The router returned no report')
  return result
}

export function useNetworkReport() {
  return useMutation({ mutationFn: readNetworkReport })
}
