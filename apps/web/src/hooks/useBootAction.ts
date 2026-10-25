import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QUERY_KEY_ROUTER_STATUS } from '~/hooks/useRouterStatus'

interface LuCIRpc {
  declare: (spec: object) => (params?: object) => Promise<unknown>
}

// `daed-router action` 是面板 ACL 授予的唯一写权限。
// 脚本侧白名单 start|restart|stop|boot_enable|boot_disable，
// 并且始终返回 {"success": boolean}，
// 所以被拒绝的动作会 resolve 而不是 throw。
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
    // 开关位置读自 status 载荷，所以写完之后重新拉取，
    // 不去假设写入已经按请求生效。
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_ROUTER_STATUS }),
  })
}
