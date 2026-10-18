import { useGeneralQuery, useRunMutation } from '~/apis'
import { Button } from '~/components/ui/button'

export function RouterHeader() {
  const { data } = useGeneralQuery()
  const run = useRunMutation()
  const running = data?.general.dae.running ?? false

  return (
    <header className="flex items-center justify-between border-b bg-card px-5 py-3">
      <span className="text-sm font-medium">{running ? '代理运行中' : '代理已停止'}</span>
      <div className="flex gap-2">
        {data?.general.dae.modified && (
          <Button variant="outline" size="sm" loading={run.isPending} onClick={() => run.mutateAsync(false)}>
            应用配置
          </Button>
        )}
        <Button size="sm" loading={run.isPending} onClick={() => run.mutateAsync(running)}>
          {running ? '停止代理' : '启动代理'}
        </Button>
      </div>
    </header>
  )
}
