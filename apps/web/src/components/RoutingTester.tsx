import { FlaskConical } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertBanner } from '~/components/ui/alert-banner'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { cn } from '~/lib/utils'
import { testRouting } from '~/utils/routing-tester'

/**
 * 分流规则测试器。
 *
 * 回答问题：「这个站点会被哪条规则接住、走哪个出口、为什么」。
 *
 * 以前只能真去访问一次再翻日志；而最常见的故障是规则写得没错、
 * 只是被前面某条更宽的规则挡住了，这种情况在保存时完全查不出来。
 *
 * 判不了的情况会如实标出（geosite 分类的域名清单不在前端），
 * 不会假装判成「不匹配」——那会让人误删一条其实有效的规则。
 */
export function RoutingTester({ source, groups }: { source: string; groups: string[] }) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [port, setPort] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const result = useMemo(() => (submitted ? testRouting(source, input, port) : null), [submitted, source, input, port])

  const actionTone =
    result?.action === 'proxy'
      ? 'text-emerald-700 dark:text-emerald-400'
      : result?.action === 'block'
        ? 'text-destructive'
        : 'text-muted-foreground'

  function run() {
    setSubmitted(true)
  }

  return (
    <section className="rounded-2xl border bg-card p-4" aria-label={t('routingTester.title')}>
      <div className="mb-3 flex items-start gap-2">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('routingTester.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('routingTester.description')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="routing-tester-domain" className="text-xs">
            {t('routingTester.domain')}
          </Label>
          <Input
            id="routing-tester-domain"
            className="mt-1"
            placeholder="www.youtube.com"
            spellCheck={false}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              setSubmitted(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') run()
            }}
          />
        </div>
        <div className="w-24">
          <Label htmlFor="routing-tester-port" className="text-xs">
            {t('routingTester.port')}
          </Label>
          <Input
            id="routing-tester-port"
            className="mt-1"
            inputMode="numeric"
            placeholder="443"
            value={port}
            onChange={(event) => {
              setPort(event.target.value.replace(/\D/g, ''))
              setSubmitted(false)
            }}
          />
        </div>
        <Button type="button" size="sm" className="h-9" onClick={run}>
          {t('routingTester.run')}
        </Button>
      </div>

      {result?.error === 'invalid-domain' && (
        <AlertBanner tone="warning" className="mt-3">
          {t('routingTester.invalidDomain')}
        </AlertBanner>
      )}
      {result?.error === 'empty-routing' && (
        <AlertBanner tone="warning" className="mt-3">
          {t('routingTester.emptyRouting')}
        </AlertBanner>
      )}

      {result && !result.error && (
        <div className="mt-3 space-y-3">
          {/* 结论放在最上面：用户要的就这一句。 */}
          <div className="rounded-lg border bg-muted/40 p-3">
            {result.hit ? (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('routingTester.hitRule')}</span>
                  <span className="ml-1 font-mono">#{result.hit.line}</span>
                  <span className={cn('ml-2 font-semibold', actionTone)}>
                    {result.action === 'proxy'
                      ? `${t('routingTester.viaProxy')} → ${result.hit.target}`
                      : result.action === 'block'
                        ? t('routingTester.viaBlock')
                        : t('routingTester.viaDirect')}
                  </span>
                </p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{result.hit.raw.trim()}</p>
                {result.action === 'proxy' && groups.length > 0 && !groups.includes(result.hit.target) && (
                  // 群组名写错是最常见的配置错误之一，这里直接点出来。
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {t('routingTester.groupMissing', { group: result.hit.target })}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('routingTester.noMatch')}</p>
            )}
          </div>

          {result.shadowed.length > 0 && (
            <AlertBanner tone="info" title={t('routingTester.shadowedTitle')}>
              {t('routingTester.shadowed', { lines: result.shadowed.join('、') })}
            </AlertBanner>
          )}

          {/* 逐条推理：为什么是这条、为什么不是别的。 */}
          <details className="rounded-lg border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t('routingTester.trace', { count: result.evaluations.length })}
            </summary>
            <ol className="mt-2 space-y-0.5 font-mono text-xs">
              {result.evaluations.map((item) => (
                <li
                  key={item.line}
                  className={cn(
                    'grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-2 rounded px-1 py-0.5',
                    result.hit?.line === item.line && 'bg-muted',
                  )}
                >
                  <span className="text-muted-foreground tabular-nums">{item.line}</span>
                  <span
                    className={cn(
                      'font-semibold',
                      item.verdict === 'match'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : item.verdict === 'no-match'
                          ? 'text-muted-foreground'
                          : 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {item.verdict === 'match' ? '✓' : item.verdict === 'no-match' ? '✗' : '?'}
                  </span>
                  <span className="min-w-0 truncate" title={item.raw.trim()}>
                    {item.raw.trim() || '—'}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">{t('routingTester.legend')}</p>
          </details>
        </div>
      )}
    </section>
  )
}
