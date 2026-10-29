import type { MixedProxyDraft } from '~/utils/mixed-proxy'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Cable, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsSaveState } from '~/components/SettingsSaveState'
import { AlertBanner } from '~/components/ui/alert-banner'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { useUnsavedSettings } from '~/hooks/useUnsavedSettings'
import {
  mixedDraft,
  mixedDraftChanged,
  mixedRuntimeTone,
  readMixedSettings,
  saveMixedSettings,
} from '~/utils/mixed-proxy'

export function MixedProxySettings() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['mixed-settings'],
    queryFn: readMixedSettings,
    refetchInterval: 3000,
    retry: false,
  })
  const [draft, setDraft] = useState<MixedProxyDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saved = query.data
  const fields = draft || (saved ? mixedDraft(saved) : { enabled: false, port: '7893', lan: false })
  const dirty = !!saved && mixedDraftChanged(fields, saved)
  useUnsavedSettings('mixed', dirty)
  const validPort = /^\d+$/.test(fields.port) && Number(fields.port) >= 1024 && Number(fields.port) <= 65535
  const needsRetry =
    !!saved &&
    ['pending', 'port_in_use', 'lan_unavailable', 'bind_failed', 'listener_failed', 'listener_stopped'].includes(
      saved.runtime.state,
    )
  const state = busy ? 'saving' : error || query.isError ? 'failed' : dirty ? 'dirty' : !saved ? 'loading' : 'saved'
  async function save() {
    setBusy(true)
    setError('')
    try {
      const stored = await saveMixedSettings(fields)
      client.setQueryData(['mixed-settings'], stored)
      setDraft(null)
      toast.success(t('mixed.saved'))
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(t(code === 'busy' ? 'mixed.busy' : 'mixed.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-2xl border bg-card p-5" aria-label={t('mixed.title')}>
      <div className="mb-4 flex items-start gap-2">
        <Cable className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold">{t('mixed.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('mixed.description')}</p>
        </div>
      </div>
      {query.isError && (
        <div className="mb-4">
          <AlertBanner tone="warning">
            {t(saved ? 'mixed.statusStale' : 'mixed.loadFailed')}
            <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw className="h-4 w-4" />
              {t('mixed.refresh')}
            </Button>
          </AlertBanner>
        </div>
      )}
      {saved && (
        <div className="mb-4" data-testid="mixed-runtime">
          <AlertBanner
            tone={query.isError ? 'warning' : mixedRuntimeTone(saved.runtime.state)}
            title={t('mixed.runtimeTitle')}
          >
            {query.isError ? t('mixed.statusUnknown') : t(`mixed.states.${saved.runtime.state}`)}
            {!query.isError && saved.runtime.address && (
              <code className="mt-1 block break-all">{saved.runtime.address}</code>
            )}
          </AlertBanner>
        </div>
      )}
      {query.isPending ? (
        <p role="status">{t('notify.loading')}</p>
      ) : (
        <fieldset disabled={busy || !saved} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="mixed-enabled">{t('mixed.enable')}</Label>
            <Switch
              id="mixed-enabled"
              checked={fields.enabled}
              onCheckedChange={(enabled) => setDraft({ ...fields, enabled })}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="mixed-port">{t('mixed.port')}</Label>
              <Input
                id="mixed-port"
                className="mt-2"
                inputMode="numeric"
                value={fields.port}
                aria-invalid={!validPort}
                onChange={(e) => setDraft({ ...fields, port: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('mixed.portHint')}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="mixed-lan">{t('mixed.lan')}</Label>
                <Switch id="mixed-lan" checked={fields.lan} onCheckedChange={(lan) => setDraft({ ...fields, lan })} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('mixed.lanHint')}</p>
            </div>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">{t(dirty ? 'mixed.draftAddress' : 'mixed.connect')}</p>
            <code className="block break-all">
              {fields.lan ? saved?.host || t('mixed.routerIP') : '127.0.0.1'}:{fields.port}
            </code>
            <p className="mt-2 text-xs text-muted-foreground">{t('mixed.connectHint')}</p>
          </div>
          <div className="space-y-3 border-t pt-4">
            <SettingsSaveState state={state} effect={t('saveState.restartEffect')} />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!validPort || busy || (!dirty && !needsRetry) || query.isError}
                onClick={() => void save()}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t(!dirty && needsRetry ? 'mixed.reapply' : 'notify.save')}
              </Button>
              <Button
                variant="outline"
                disabled={!dirty || busy}
                onClick={() => {
                  setDraft(null)
                  setError('')
                }}
              >
                {t('saveState.reset')}
              </Button>
            </div>
          </div>
        </fieldset>
      )}
      {error && (
        <div className="mt-3">
          <AlertBanner tone="danger">{error}</AlertBanner>
        </div>
      )}
    </section>
  )
}
