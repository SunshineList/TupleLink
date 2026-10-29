import { Bell, Loader2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  looksLikeBotToken,
  looksLikeChatId,
  readNotifySettings,
  saveNotifySettings,
  sendNotifyTest,
} from '~/utils/notify-settings'

/**
 * Telegram 通知设置。
 *
 * 只推「需要用户知道结果」的事件：更新完成/失败、规则库更新、服务异常、
 * 订阅失败、节点全挂。界面上的即时错误不推——用户就在看着，推了是噪音。
 *
 * token 不会回显：后端只返回「填没填」。要改就整段重填，
 * 因为把明文 token 送到浏览器意味着它会出现在状态树、截图和抓包里。
 */
export function NotifySettings() {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<{ enabled: boolean; chat: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenSet, setTokenSet] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [chat, setChat] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    readNotifySettings()
      .then((settings) => {
        if (!alive) return
        setSaved({ enabled: settings.enabled, chat: settings.chat })
        setEnabled(settings.enabled)
        setTokenSet(settings.tokenSet)
        setChat(settings.chat)
      })
      .catch(() => alive && setError(t('notify.loadFailed')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [t])

  // 本地先挡一道：用户粘错时立刻反馈，不用等保存后推送静默失败。
  const tokenValid = token === '' || looksLikeBotToken(token)
  const chatValid = chat === '' || looksLikeChatId(chat)
  const complete = (tokenSet || !!token.trim()) && !!chat.trim()
  const dirty = !!saved && (enabled !== saved.enabled || chat.trim() !== saved.chat || !!token.trim())
  useUnsavedSettings('notify', dirty)
  const canSave = !!saved && tokenValid && chatValid && (!enabled || complete)

  async function save(nextEnabled = enabled, testing = false) {
    setBusy(true)
    setError('')
    setTestResult(null)
    try {
      await saveNotifySettings({
        enabled: nextEnabled,
        // 留空表示不修改，只改 chat_id 时不会把已存的 token 冲掉。
        token: token.trim() || undefined,
        chat: chat.trim() || undefined,
      })
      const stored = await readNotifySettings()
      if (
        stored.enabled !== nextEnabled ||
        (token.trim() && !stored.tokenSet) ||
        (chat.trim() && stored.chat !== chat.trim())
      ) {
        throw new Error('state_failed')
      }
      setSaved({ enabled: stored.enabled, chat: stored.chat })
      setEnabled(stored.enabled)
      setTokenSet(stored.tokenSet)
      setChat(stored.chat)
      setToken('')
      if (!testing) toast.success(t('notify.saved'))
      return true
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(
        code === 'invalid_token'
          ? t('notify.invalidToken')
          : code === 'invalid_chat'
            ? t('notify.invalidChat')
            : t('notify.saveFailed'),
      )
      return false
    } finally {
      if (!testing) setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setError('')
    setTestResult(null)
    try {
      // 先存再测：否则用户改了 chat_id 直接点测试，测的还是旧值。
      if (!(await save(enabled, true))) return
      setTestResult(await sendNotifyTest())
    } catch {
      setError(t('notify.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">{t('notify.loading')}</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border bg-card p-4" aria-label={t('notify.title')}>
      <div className="mb-3 flex items-start gap-2">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{t('notify.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('notify.description')}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          {tokenSet ? t('notify.configured') : t('notify.unconfigured')}
        </span>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="notify-enabled" className="text-sm">
              {t('notify.enable')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('notify.enableHint')}</p>
          </div>
          <Switch
            id="notify-enabled"
            checked={enabled}
            disabled={busy || !saved}
            onCheckedChange={(value) => {
              setEnabled(value)
              setTestResult(null)
            }}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="notify-token" className="text-sm">
              {t('notify.token')}
            </Label>
            <Input
              id="notify-token"
              disabled={busy || !saved}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="mt-1"
              placeholder={tokenSet ? t('notify.tokenKept') : '123456789:AAH…'}
              value={token}
              onChange={(event) => {
                setToken(event.target.value)
                setTestResult(null)
              }}
              aria-invalid={!tokenValid}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {tokenSet ? t('notify.tokenSetHint') : t('notify.tokenHint')}
            </p>
            {!tokenValid && <p className="mt-1 text-xs text-destructive">{t('notify.invalidToken')}</p>}
          </div>

          <div>
            <Label htmlFor="notify-chat" className="text-sm">
              {t('notify.chat')}
            </Label>
            <Input
              id="notify-chat"
              disabled={busy || !saved}
              className="mt-1"
              spellCheck={false}
              placeholder="-1001234567890 / @channel"
              value={chat}
              onChange={(event) => {
                setChat(event.target.value)
                setTestResult(null)
              }}
              aria-invalid={!chatValid}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('notify.chatHint')}</p>
            {!chatValid && <p className="mt-1 text-xs text-destructive">{t('notify.invalidChat')}</p>}
          </div>
        </div>
        <div className="border-t pt-4">
          <SettingsSaveState
            state={busy ? 'saving' : error ? 'failed' : dirty ? 'dirty' : saved ? 'saved' : 'loading'}
            effect={t('saveState.immediateEffect')}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="h-9"
            disabled={busy || !canSave || !dirty}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('notify.save')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9"
            disabled={busy || !canSave || !complete}
            onClick={() => void test()}
          >
            <Send className="h-4 w-4" />
            {t('notify.test')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9"
            disabled={busy || !dirty || !saved}
            onClick={() => {
              if (!saved) return
              setEnabled(saved.enabled)
              setChat(saved.chat)
              setToken('')
              setError('')
              setTestResult(null)
            }}
          >
            {t('saveState.reset')}
          </Button>
        </div>

        {error && (
          <AlertBanner tone="danger" title={t('notify.errorTitle')}>
            {error}
          </AlertBanner>
        )}

        {testResult === 'sent' && <AlertBanner tone="success">{t('notify.testSent')}</AlertBanner>}
        {testResult === 'not_configured' && <AlertBanner tone="warning">{t('notify.testNotConfigured')}</AlertBanner>}
        {testResult === 'disabled' && <AlertBanner tone="info">{t('notify.testDisabled')}</AlertBanner>}
        {testResult === 'send_failed' && (
          <AlertBanner tone="danger" title={t('notify.testFailedTitle')}>
            {t('notify.testFailed')}
          </AlertBanner>
        )}
        {testResult === 'rate_limited' && <AlertBanner tone="warning">{t('notify.rateLimited')}</AlertBanner>}
        {testResult === 'no_client' && <AlertBanner tone="warning">{t('notify.testNoClient')}</AlertBanner>}
      </div>
    </section>
  )
}
