import { Bell, Loader2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertBanner } from '~/components/ui/alert-banner'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
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
  const canSave = tokenValid && chatValid && !(enabled && !tokenSet && !token.trim() && chat.trim() === '')

  async function save(nextEnabled = enabled) {
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
      setEnabled(nextEnabled)
      if (token.trim()) {
        setTokenSet(true)
        setToken('')
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(
        code === 'invalid_token'
          ? t('notify.invalidToken')
          : code === 'invalid_chat'
            ? t('notify.invalidChat')
            : t('notify.saveFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setError('')
    setTestResult(null)
    try {
      // 先存再测：否则用户改了 chat_id 直接点测试，测的还是旧值。
      await save()
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
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('notify.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('notify.description')}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="notify-enabled" className="text-sm">
              {t('notify.enable')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('notify.enableHint')}</p>
          </div>
          <Switch id="notify-enabled" checked={enabled} disabled={busy} onCheckedChange={(value) => void save(value)} />
        </div>

        <div>
          <Label htmlFor="notify-token" className="text-sm">
            {t('notify.token')}
          </Label>
          <Input
            id="notify-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="mt-1"
            placeholder={tokenSet ? t('notify.tokenKept') : '123456789:AAH…'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
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
            className="mt-1"
            spellCheck={false}
            placeholder="-1001234567890 / @channel"
            value={chat}
            onChange={(event) => setChat(event.target.value)}
            aria-invalid={!chatValid}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('notify.chatHint')}</p>
          {!chatValid && <p className="mt-1 text-xs text-destructive">{t('notify.invalidChat')}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-9" disabled={busy || !canSave} onClick={() => void save()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('notify.save')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9"
            disabled={busy || tokenSet === false}
            onClick={() => void test()}
          >
            <Send className="h-4 w-4" />
            {t('notify.test')}
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
        {testResult === 'no_client' && <AlertBanner tone="warning">{t('notify.testNoClient')}</AlertBanner>}
      </div>
    </section>
  )
}
