import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QUERY_KEY_ROUTER_STATUS } from '~/hooks/useRouterStatus'

interface LuCIRpc {
  declare: (spec: object) => (params?: object) => Promise<unknown>
}

// `daed-router action` is the only write the panel ACL grants. The shell helper
// whitelists start|restart|stop|boot_enable|boot_disable and always answers
// {"success": boolean}, so a rejected action resolves instead of throwing.
export type BootAction = 'boot_enable' | 'boot_disable'

interface ActionResult {
  success?: boolean
  message?: string
}

async function callAction(action: BootAction): Promise<ActionResult> {
  const host = window.parent as Window & { L?: { require: (name: string) => Promise<LuCIRpc> } }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  const rpc = await host.L.require('rpc')
  const result = (await rpc.declare({ object: 'daed-router', method: 'action', params: ['action'], expect: {} })({
    action,
  })) as ActionResult | undefined
  if (result?.success !== true) throw new Error(result?.message || 'The router rejected the boot setting')
  return result
}

export function useBootAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: callAction,
    // The switch position is read from the status payload, so re-read it instead
    // of assuming the write landed the way it was asked to.
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_ROUTER_STATUS }),
  })
}
