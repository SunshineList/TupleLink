import { useIsMutating } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useGeneralQuery, useRunMutation } from '~/apis'
import { Button } from '~/components/ui/button'

export function RouterHeader() {
  const { t } = useTranslation()
  const query = useGeneralQuery()
  const run = useRunMutation()
  const saving = useIsMutating() > 0
  const [operation, setOperation] = useState<'apply' | 'toggle'>('toggle')
  const [failed, setFailed] = useState(false)
  const running = query.data?.general.dae.running ?? false
  const modified = query.data?.general.dae.modified ?? false
  const invoke = async (action: 'apply' | 'toggle') => {
    if (saving) return
    setOperation(action)
    setFailed(false)
    try {
      await run.mutateAsync(action === 'apply' ? false : running)
      toast.success(action === 'apply' ? t('panel.applied') : running ? t('panel.stopped') : t('panel.running'))
    } catch {
      setFailed(true)
    }
  }
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('panel.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('panel.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            role="status"
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${running ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {query.isPending || query.isError ? t('panel.checking') : running ? t('panel.running') : t('panel.stopped')}
          </span>
          {(modified || (saving && !run.isPending)) && (
            <span role="status" className="text-xs text-muted-foreground">
              {saving && !run.isPending ? t('panel.saving') : t('panel.unapplied')}
            </span>
          )}
          {modified && (
            <Button
              size="sm"
              disabled={saving || query.isError}
              aria-busy={run.isPending && operation === 'apply'}
              onClick={() => invoke('apply')}
            >
              {run.isPending && operation === 'apply' ? t('panel.applying') : t('panel.apply')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={saving || query.isPending || query.isError}
            aria-busy={run.isPending && operation === 'toggle'}
            onClick={() => invoke('toggle')}
          >
            {run.isPending && operation === 'toggle'
              ? running
                ? t('panel.stopping')
                : t('panel.starting')
              : running
                ? t('panel.stop')
                : t('panel.start')}
          </Button>
        </div>
        {(failed || query.isError) && (
          <div
            role="alert"
            className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm"
          >
            <span>{failed ? t('panel.runFailed') : t('panel.loadFailed')}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => (failed ? invoke(operation) : query.refetch())}
              disabled={saving}
            >
              {t('panel.retry')}
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
