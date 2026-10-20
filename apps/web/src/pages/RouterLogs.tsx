import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

// Use the same read-only LuCI RPC as the native logs view. Never expose a new
// unauthenticated backend URL or pass the LuCI session through a query string.
async function readRouterLogs() {
  const host = window.parent as Window & {
    L?: { require: (name: string) => Promise<{ declare: (spec: object) => () => Promise<{ logs?: string }> }> }
  }
  if (host === window || !host.L?.require) throw new Error('请从路由器后台进入运行日志。')
  const rpc = await host.L.require('rpc')
  return rpc.declare({ object: 'daed-router', method: 'logs', expect: {} })()
}

export function RouterLogs() {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['router-logs'], queryFn: readRouterLogs, refetchInterval: 5000, retry: false })
  return (
    <section className="rounded-2xl border bg-card p-5" aria-label="运行日志">
      <h2 className="mb-4 text-lg font-semibold">NaiLink 运行日志</h2>
      {query.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          日志读取失败，请检查后台登录状态。
          <button className="ml-2 underline" onClick={() => query.refetch()}>
            {t('panel.retry')}
          </button>
        </p>
      )}
      <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words text-sm">
        {query.data?.logs || (query.isPending ? '正在读取日志…' : '暂无日志。')}
      </pre>
    </section>
  )
}
