import { useIsMutating } from '@tanstack/react-query'
import { Activity, HardDriveDownload, Network, Power, Stethoscope } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useGeneralQuery, useRunMutation } from '~/apis'
import { CommunityLinks } from '~/components/CommunityLinks'
import { ConfigBackupDialog } from '~/components/ConfigBackupDialog'
import { NetworkCheckDialog } from '~/components/NetworkCheckDialog'
import { HealthChip, RouterHealth } from '~/components/RouterHealth'
import { RouterVersion } from '~/components/RouterMaintenance'
import { ThemePicker } from '~/components/ThemePicker'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { useRouterStatus } from '~/hooks/useRouterStatus'
import { summariseHealth } from '~/utils/router-health'

const TITLES = {
  dashboard: 'panel.dashboard',
  logs: 'panel.logs',
  resources: 'panel.resources',
  advanced: 'panel.advanced',
} as const

export function RouterHeader() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const title = TITLES[pathname.replace('/', '') as keyof typeof TITLES] ?? TITLES.dashboard
  const query = useGeneralQuery()
  const status = useRouterStatus()
  const health = summariseHealth(status.data)
  const [healthOpen, setHealthOpen] = useState(false)
  const [networkOpen, setNetworkOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const run = useRunMutation()
  const saving =
    useIsMutating({ predicate: (mutation) => mutation.options.mutationKey?.[0] !== 'node-latency-test' }) > 0
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
      // 服务状态和诊断是一起变的；重新拉一次检查项，
      // 让头部胶囊在启动/停止/应用之后不会报过时的结论。
      void status.refetch()
    } catch {
      setFailed(true)
    }
  }
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
      <div className="router-toolbar mx-auto grid max-w-[1400px] items-center gap-3 px-4 py-3 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-base font-semibold tracking-tight">{t(title)}</h1>
        </div>
        <CommunityLinks />
        <div className="router-toolbar-actions flex flex-wrap items-center gap-2">
          {health.level !== 'unknown' && (
            <Button
              variant="ghost"
              size="sm"
              className="router-health-trigger h-auto min-h-0 px-1"
              aria-label={t('health.open')}
              aria-haspopup="dialog"
              onClick={() => setHealthOpen(true)}
            >
              <HealthChip status={status.data} />
            </Button>
          )}
          <RouterVersion />
          <ThemePicker variant="compact" />
          <span
            role="status"
            aria-label={
              query.isPending || query.isError ? t('panel.checking') : running ? t('panel.running') : t('panel.stopped')
            }
            className={`router-status-pill inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${running ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            <span className="router-status-text">
              {query.isPending || query.isError ? t('panel.checking') : running ? t('panel.running') : t('panel.stopped')}
            </span>
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
            <Power className="h-3.5 w-3.5" aria-hidden="true" />
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
            className="col-span-full flex w-full flex-wrap items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm"
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
      <Sheet open={healthOpen} onOpenChange={setHealthOpen}>
        <SheetContent side="right" size="lg" className="gap-0">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Stethoscope aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              {t('health.title')}
            </SheetTitle>
            <SheetDescription>{t('health.description')}</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-4">
            <RouterHealth status={status.data} />
            {status.isError && <p className="mt-3 text-xs text-muted-foreground">{t('health.unavailable')}</p>}
            {health.level === 'error' && (
              <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                {t('health.blockedHint')}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                // 两个都是 Radix modal；先关掉抽屉再开对话框，
                // 这样只会有一个 focus trap，不会因为叠两个而丢 pointer events。
                setHealthOpen(false)
                setNetworkOpen(true)
              }}
            >
              <Network aria-hidden="true" />
              {t('network.open')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 ml-2"
              onClick={() => {
                // 同样先关抽屉再开对话框，避免两个 modal 的 focus trap 打架。
                setHealthOpen(false)
                setBackupOpen(true)
              }}
            >
              <HardDriveDownload aria-hidden="true" />
              {t('backup.open')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <NetworkCheckDialog open={networkOpen} onOpenChange={setNetworkOpen} />
      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <ConfigBackupDialog onOpenChange={setBackupOpen} />
      </Dialog>
    </header>
  )
}
