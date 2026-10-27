import { useMutation } from '@tanstack/react-query'
import { readExitIP } from '~/utils/exit-ip'

/**
 * 出口 IP 自检。
 *
 * 用 mutation 而不是 query：这个调用会让路由器主动去访问外网，
 * 不适合自动触发或轮询，必须由用户点一下。
 */
export function useExitIP() {
  return useMutation({ mutationFn: readExitIP })
}
