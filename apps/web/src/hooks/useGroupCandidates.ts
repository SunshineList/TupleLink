import { useQuery } from '@tanstack/react-query'
import { readGroupCandidates } from '~/utils/group-candidates'

/**
 * 群组当前选中的节点。
 *
 * 与出口 IP 不同，这个数据是内核的实时状态，不发起任何外网请求，
 * 所以可以安全地定时刷新。节点会随线路波动自动切换，
 * 10 秒一次既跟得上变化，也不会给路由器增加负担。
 *
 * 失败时保留上一次结果：一次 RPC 抖动不该让「当前在用谁」变成空白。
 */
export function useGroupCandidates() {
  return useQuery({
    queryKey: ['group-candidates'],
    queryFn: readGroupCandidates,
    refetchInterval: 10000,
    staleTime: 5000,
    retry: false,
  })
}
