import type { RouterStatus } from '~/utils/router-health'
import { useQuery } from '@tanstack/react-query'
import { routerMode } from '~/utils/router-mode'

// Reuse the same read-only LuCI RPC object the native views declare. The panel is
// served from /cgi-bin/daed-router/, so the LuCI window is the parent frame.
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

// Diagnostics change only when the service or the package changes, so this is
// polled far slower than the runtime overview and never in the background.
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
