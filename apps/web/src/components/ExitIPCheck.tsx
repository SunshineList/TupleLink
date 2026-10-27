import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AlertBanner } from '~/components/ui/alert-banner'
import { Button } from '~/components/ui/button'
import { useExitIP } from '~/hooks/useExitIP'
import { describeExit, proxyInEffect } from '~/utils/exit-ip'

/**
 * 出口 IP 自检卡片。
 *
 * 面板上一直没有一处能回答「现在到底从哪出去」。用户判断分流是否生效，
 * 只能拿手机打开 ip.sb 去猜；人从外面通过 VPN 连回来上不了网时，
 * 更是完全不知道流量走的是哪条路。
 *
 * 这里并排显示两个出口：
 *   直连   绕过代理直接出去
 *   当前   日常上网时的真实路径
 * 两者不同，说明流量确实被送去了别处。
 *
 * 必须手动触发：每次点击都会让路由器主动访问外网，
 * 不该在页面打开时就悄悄跑，也不该轮询。
 */
export function ExitIPCheck() {
  const { t } = useTranslation()
  const mutation = useExitIP()
  const result = mutation.data
  const inEffect = proxyInEffect(result)

  return (
    <section className="rounded-2xl border bg-card p-4" aria-label={t('exitIP.title')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('exitIP.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('exitIP.description')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
          {mutation.isPending ? t('exitIP.checking') : t('exitIP.check')}
        </Button>
      </div>

      {mutation.isError && (
        <AlertBanner tone="warning" title={t('exitIP.failedTitle')}>
          {t('exitIP.failed')}
        </AlertBanner>
      )}

      {result && !mutation.isError && (
        <>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">{t('exitIP.direct')}</dt>
              <dd className="mt-0.5 truncate font-mono text-sm" title={result.direct}>
                {result.direct || '—'}
              </dd>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">{t('exitIP.proxied')}</dt>
              <dd className="mt-0.5 truncate font-mono text-sm" title={result.proxied}>
                {result.proxied || '—'}
              </dd>
            </div>
          </dl>
          <AlertBanner tone={result.verdict === 'unknown' ? 'info' : inEffect ? 'success' : 'warning'} className="mt-3">
            {t(describeExit(result))}
          </AlertBanner>
        </>
      )}

      {!result && !mutation.isError && !mutation.isPending && (
        <p className="text-xs text-muted-foreground">{t('exitIP.idle')}</p>
      )}
    </section>
  )
}
