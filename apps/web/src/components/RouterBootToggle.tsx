import type { RouterStatus } from '~/utils/router-health'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Switch } from '~/components/ui/switch'
import { useBootAction } from '~/hooks/useBootAction'
import { cn } from '~/lib/utils'
import { bootAction, bootState } from '~/utils/router-health'

// 手动启动的代理只能活到下次重启。路由器侧一直通过面板已经在用的
// 同一套 RPC 对象暴露 `boot_enable`/`boot_disable`，
// 但从来没人调用过，所以想让断电后代理自动回来，
// 唯一的办法是去 LuCI 的 init 脚本页。
export function RouterBootToggle({ status, className }: { status?: RouterStatus | null; className?: string }) {
  const { t } = useTranslation()
  const state = bootState(status)
  const next = bootAction(state)
  const action = useBootAction()

  if (state === 'unknown') {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>{t('health.bootUnknown')}</p>
    )
  }

  const checked = state === 'enabled'

  return (
    <div className={cn('flex items-start justify-between gap-3 rounded-lg border p-3', className)}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{t('health.bootTitle')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {checked ? t('health.bootOnHint') : t('health.bootOffHint')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action.isPending && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch
          checked={checked}
          disabled={!next || action.isPending}
          aria-label={t('health.bootTitle')}
          onCheckedChange={() => {
            if (!next) return
            action.mutate(next, {
              onSuccess: () => toast.success(next === 'boot_enable' ? t('health.bootEnabled') : t('health.bootDisabled')),
              onError: (error: Error) => toast.error(error.message),
            })
          }}
        />
      </div>
    </div>
  )
}
