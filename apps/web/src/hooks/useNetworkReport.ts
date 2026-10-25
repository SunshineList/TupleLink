import { useMutation } from '@tanstack/react-query'

interface LuCIRpc {
  declare: (spec: object) => (params?: object) => Promise<unknown>
}

export interface NetworkReport {
  output: string
  truncated?: boolean
  note?: string
}

// The check runs on demand only: it opens HTTPS connections through whatever
// datapath is active, so polling it would generate traffic the user never asked
// for. The router caps the run at 45s and the reply at 32 KiB.
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
