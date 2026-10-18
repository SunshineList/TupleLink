import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { SimpleTooltip } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'

export function Section({
  title,
  icon,
  bordered,
  iconPlus,
  onCreate,
  actions,
  highlight,
  count,
  createLabel,
  primary,
  loading,
  error,
  onRetry,
  className,
  contentClassName,
  children,
}: {
  title: string
  icon?: React.ReactNode
  bordered?: boolean
  iconPlus?: React.ReactNode
  onCreate: () => void
  actions?: React.ReactNode
  highlight?: boolean
  count?: number
  createLabel?: string
  primary?: boolean
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  className?: string
  contentClassName?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div
      data-testid="section"
      className={cn(
        'panel-section min-w-0 flex flex-col gap-4',
        bordered && 'rounded-2xl border bg-card p-4 shadow-sm',
        highlight && 'border-primary/60 bg-primary/5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-muted-foreground">
            {icon}
          </span>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {count !== undefined && (
            <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {actions}
          <SimpleTooltip label={createLabel || `${t('actions.add')} ${title}`}>
            <Button
              variant={primary ? 'default' : 'outline'}
              size="sm"
              onClick={onCreate}
              aria-label={createLabel || `${t('actions.add')} ${title}`}
            >
              <span aria-hidden="true">{iconPlus || <Plus className="h-4 w-4" />}</span>
              {createLabel || t('actions.add')}
            </Button>
          </SimpleTooltip>
        </div>
      </div>

      {error && (
        <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p>{t('panel.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
            {t('panel.retry')}
          </Button>
        </div>
      )}
      {loading ? (
        <div role="status" aria-label={t('panel.loading')} className="space-y-3 motion-safe:animate-pulse">
          {[1, 2, 3].map((key) => (
            <div key={key} className="h-20 rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className={cn('flex min-w-0 flex-col gap-3', contentClassName)}>{children}</div>
      )}
    </div>
  )
}
