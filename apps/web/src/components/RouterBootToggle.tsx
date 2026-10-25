import type { RouterStatus } from '~/utils/router-health'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Switch } from '~/components/ui/switch'
import { useBootAction } from '~/hooks/useBootAction'
import { cn } from '~/lib/utils'
import { bootAction, bootState } from '~/utils/router-health'

// Starting the proxy by hand only lasts until the next reboot. The router has
// always exposed `boot_enable`/`boot_disable` through the same RPC object the
// panel already reads, but nothing called them, so the only way to make the
// proxy come back after a power cut was the LuCI init script page.
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
