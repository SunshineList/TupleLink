import type { RouterStatus } from '~/utils/router-health'
import { useQuery } from '@tanstack/react-query'
import { routerMode } from '~/utils/router-mode'

// 复用原生 LuCI 视图声明的同一套只读 RPC 对象。
// 面板从 /cgi-bin/daed-router/ 提供，所以 LuCI 窗口是父 frame。
interface LuCIRpc {
  declare: (spec: object) => () => Promise<RouterStatus>
}

async function readRouterStatus(): Promise<RouterStatus> {
  const host = window.parent as Window & { L?: { require: (name: string) => Promise<LuCIRpc> } }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  const rpc = await host.L.require('rpc')
  return rpc.declare({ object: 'daed-router', method: 'status', expect: {} })()
}

export const QUERY_KEY_ROUTER_STATUS = ['router-status']

// 诊断数据只在服务或软件包变更时才变化，所以轮询频率远低于运行时概览，
// 也从不在后台持续轮询。
export function useRouterStatus() {
  return useQuery({
    queryKey: QUERY_KEY_ROUTER_STATUS,
    queryFn: readRouterStatus,
    enabled: routerMode,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 10_000,
  })
}
