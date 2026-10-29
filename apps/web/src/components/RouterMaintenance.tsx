import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsSaveState } from '~/components/SettingsSaveState'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { useRouterMaintenance } from '~/hooks/useRouterMaintenance'
import { useUnsavedSettings } from '~/hooks/useUnsavedSettings'
import { jobActive, maintenanceMessages, newerVersion, setMaintenanceMirror } from '~/utils/router-maintenance'

function MaintenanceProgress({ type }: { type: 'update' | 'geodata' }) {
  const { t } = useTranslation()
  const { query, mutation } = useRouterMaintenance()
  const job = query.data?.job
  if (!job || (type === 'geodata' ? job.action !== 'geodata' : job.action === 'geodata')) return null
  return (
    <div
      role={job.state === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border p-3 text-sm ${job.state === 'error' ? 'border-destructive/30 text-destructive' : 'bg-muted/40'}`}
    >
      <p className="flex items-center gap-2">
        {jobActive(job) && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {job.state === 'error'
          ? t(maintenanceMessages[job.code || ''] || maintenanceMessages.operation_failed, {
              defaultValue: t('maintenance.operation_failed'),
            })
          : job.state === 'success'
            ? job.action === 'check'
              ? t('maintenance.checkDone')
              : type === 'geodata'
                ? job.code === 'already_latest'
                  ? t('maintenance.rulesLatest')
                  : t('maintenance.rulesUpdated')
                : t('maintenance.updateDone')
            : job.phase
              ? t(`maintenance.phases.${job.phase}`, { defaultValue: t('maintenance.phaseUnknown') })
              : t('maintenance.phaseUnknown')}
      </p>
      {query.isError && <p className="mt-1 text-xs">{t('maintenance.statusReconnecting')}</p>}
      {job.state === 'success' && job.action === 'update' && (
        <Button size="sm" className="mt-3 min-h-11" onClick={() => window.parent.location.reload()}>
          {t('maintenance.reload')}
        </Button>
      )}
      {mutation.isError && <p className="mt-1">{mutation.error.message}</p>}
    </div>
  )
}

export function RouterVersion() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { query, mutation, busy } = useRouterMaintenance()
  const data = query.data
  const loadedVersion = useRef<string | undefined>(undefined)
  const latest = data?.latest
  const available = !!latest && newerVersion(latest.version, data?.current || '')
  const show = () => {
    setOpen(true)
    loadedVersion.current ??= data?.current
    const justUpdated =
      data?.job?.action === 'update' && data.job.state === 'success' && data.current !== loadedVersion.current
    if (!busy && !justUpdated) mutation.mutate('check')
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 tabular-nums text-muted-foreground hover:text-foreground"
        onClick={show}
        aria-label={t('maintenance.checkAria', { version: data?.current || t('maintenance.reading') })}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
        {data?.current ? `v${data.current}` : t('maintenance.version')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t('maintenance.title')}</DialogTitle>
            <DialogDescription>{t('maintenance.description')}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('maintenance.current')}</dt>
            <dd>{data?.current || t('maintenance.reading')}</dd>
            <dt className="text-muted-foreground">{t('maintenance.latest')}</dt>
            <dd>{latest ? `v${latest.version}` : t('maintenance.notChecked')}</dd>
          </dl>
          <MaintenanceProgress type="update" />
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          {query.isError && !busy && (
            <p role="alert" className="text-sm text-destructive">
              {t('maintenance.statusFailed')}
            </p>
          )}
          {!busy && query.data?.job?.state !== 'error' && latest && !available && (
            <p className="text-sm text-muted-foreground">{t('maintenance.upToDate')}</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => mutation.mutate('check')}>
              {t('maintenance.check')}
            </Button>
            <Button className="min-h-11" disabled={busy || !available} onClick={() => mutation.mutate('update')}>
              <Download aria-hidden="true" />
              {t('maintenance.updateTo', { version: latest?.version || t('maintenance.latestVersion') })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function RouterGeodata() {
  const { t } = useTranslation()
  const { query, mutation, busy } = useRouterMaintenance()
  const data = query.data?.geodata
  const [mirrorDraft, setMirrorDraft] = useState<string | null>(null)
  const mirror = mirrorDraft ?? query.data?.mirror ?? ''
  const mirrorDirty = !!query.data && mirror.trim().replace(/\/+$/, '') !== (query.data.mirror || '')
  useUnsavedSettings('mirror', mirrorDirty)
  const [saving, setSaving] = useState(false)
  const [mirrorError, setMirrorError] = useState('')
  async function saveMirror(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMirrorError('')
    try {
      await setMaintenanceMirror(mirror.trim())
      const stored = await query.refetch()
      if (stored.error || (stored.data?.mirror || '') !== mirror.trim().replace(/\/+$/, '')) {
        throw new Error(t('maintenance.operation_failed'))
      }
      setMirrorDraft(null)
      toast.success(t('maintenance.mirrorSaved'))
    } catch (error) {
      setMirrorError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="col-span-full rounded-xl border bg-card p-5" aria-label={t('maintenance.geodataRegion')}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{t('maintenance.geodataTitle')}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('maintenance.geodataHint')}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('maintenance.geodataSource', {
              version: data ? t('maintenance.geodataBatch', { version: data.version }) : t('maintenance.geodataSystem'),
            })}
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:border-l lg:border-border lg:pl-5">
          <Button className="min-h-11" disabled={busy || query.isError} onClick={() => mutation.mutate('geodata')}>
            <RefreshCw className={busy ? 'animate-spin' : ''} aria-hidden="true" />
            {t('maintenance.geodataUpdate')}
          </Button>
          <form onSubmit={saveMirror}>
            <label className="block text-sm font-medium" htmlFor="github-mirror">
              {t('maintenance.mirrorTitle')}
            </label>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t('maintenance.mirrorHint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                id="github-mirror"
                className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
                placeholder="https://mirror.example"
                value={mirror}
                onChange={(event) => setMirrorDraft(event.target.value)}
                disabled={saving || !query.data}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="submit"
                variant="outline"
                className="min-h-11"
                disabled={saving || !mirrorDirty || query.isError}
              >
                {saving ? t('maintenance.mirrorSaving') : t('maintenance.mirrorSave')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={saving || !mirrorDirty}
                onClick={() => {
                  setMirrorDraft(null)
                  setMirrorError('')
                }}
              >
                {t('saveState.reset')}
              </Button>
            </div>
            <div className="mt-3">
              <SettingsSaveState
                state={
                  saving ? 'saving' : mirrorError ? 'failed' : mirrorDirty ? 'dirty' : query.data ? 'saved' : 'loading'
                }
                effect={t('saveState.downloadEffect')}
              />
            </div>
            {mirrorError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {mirrorError}
              </p>
            )}
          </form>
        </div>
      </div>
      <div className="mt-3">
        <MaintenanceProgress type="geodata" />
      </div>
      {mutation.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
    </section>
  )
}
