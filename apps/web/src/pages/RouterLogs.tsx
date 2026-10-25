import type { LogLevel } from '~/utils/log-lines'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, Pause } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { parseLogLines } from '~/utils/log-lines'

// Use the same read-only LuCI RPC as the native logs view. Never expose a new
// unauthenticated backend URL or pass the LuCI session through a query string.
async function readRouterLogs() {
  const host = window.parent as Window & {
    L?: { require: (name: string) => Promise<{ declare: (spec: object) => () => Promise<{ logs?: string }> }> }
  }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  const rpc = await host.L.require('rpc')
  return rpc.declare({ object: 'daed-router', method: 'logs', expect: {} })()
}

// Only the severity that changes what a reader should do gets a colour; info and
// below stay neutral so a healthy log does not turn into a wall of badges.
const LEVEL_TONE: Record<LogLevel, string> = {
  trace: 'text-muted-foreground',
  debug: 'text-muted-foreground',
  info: 'text-muted-foreground',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-destructive',
  fatal: 'text-destructive',
  unknown: 'text-muted-foreground',
}

export function RouterLogs() {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['router-logs'], queryFn: readRouterLogs, refetchInterval: 2000, retry: false })
  const output = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  // Freeze what the user is reading while the bounded server tail keeps moving.
  const [history, setHistory] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const liveLogs = query.data?.logs ?? ''
  const logs = history ?? liveLogs
  const isFollowing = history === null
  const lines = useMemo(() => parseLogLines(logs), [logs])

  function followLatest() {
    following.current = true
    setHistory(null)
    if (output.current) output.current.scrollTop = output.current.scrollHeight
  }

  function pauseFollowing() {
    following.current = false
    setHistory(logs)
  }

  useLayoutEffect(() => {
    if (following.current && output.current) output.current.scrollTop = output.current.scrollHeight
  }, [logs, raw])

  useLayoutEffect(() => {
    const node = output.current
    const text = content.current
    if (!node || !text || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (following.current) node.scrollTop = node.scrollHeight
    })
    // Webfont loading and viewport changes can rewrap the same log snapshot.
    observer.observe(text)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  function handleScroll() {
    const node = output.current
    if (!node) return
    const atBottom = node.scrollHeight - node.clientHeight - node.scrollTop <= 24
    if (following.current && !atBottom) pauseFollowing()
    else if (!following.current && atBottom) followLatest()
  }

  return (
    <section className="rounded-2xl border bg-card p-5" aria-label={t('logs.title')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('logs.title')}</h2>
          <p id="router-log-hint" className="mt-1 text-xs text-muted-foreground" role="status">
            {query.isError
              ? t('logs.hintError')
              : isFollowing
                ? t('logs.hintLive')
                : history !== liveLogs
                  ? t('logs.hintHistoryNew')
                  : t('logs.hintHistory')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex gap-1 rounded-lg border p-0.5"
            role="group"
            aria-label={t('logs.view')}
          >
            {([false, true] as const).map((isRaw) => (
              <Button
                key={String(isRaw)}
                type="button"
                size="sm"
                variant={raw === isRaw ? 'secondary' : 'ghost'}
                aria-pressed={raw === isRaw}
                className="h-8"
                onClick={() => setRaw(isRaw)}
              >
                {t(isRaw ? 'logs.viewRaw' : 'logs.viewStructured')}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant={isFollowing ? 'outline' : 'default'}
            className="min-h-11"
            aria-controls="router-log-output"
            onClick={isFollowing ? pauseFollowing : followLatest}
          >
            {isFollowing ? <Pause aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
            {t(isFollowing ? 'logs.pause' : 'logs.resume')}
          </Button>
        </div>
      </div>
      {query.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t('logs.readFailed')}
          <button className="ml-2 min-h-11 px-2 underline" onClick={() => query.refetch()}>
            {t('panel.retry')}
          </button>
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('logs.legend')}>
        {(['debug', 'info', 'warning', 'error'] as const).map((level) => (
          <span key={level} className={cn('font-semibold uppercase', LEVEL_TONE[level])}>
            {t(`logs.level.${level}`)}
          </span>
        ))}
      </div>
      <div
        id="router-log-output"
        ref={output}
        role="region"
        aria-label={t('logs.content')}
        aria-describedby="router-log-hint"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={(event) => {
          if (event.key === 'End' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault()
            followLatest()
          } else if (['Home', 'PageUp', 'ArrowUp'].includes(event.key)) {
            pauseFollowing()
          }
        }}
        className="max-h-[65dvh] overflow-auto text-sm outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div ref={content}>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">{t(query.isPending ? 'logs.loading' : 'logs.empty')}</p>
          ) : raw ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {lines.map((line) => line.raw).join('\n')}
            </pre>
          ) : (
            <ol className="space-y-1 font-mono text-xs leading-relaxed">
              {lines.map((line, index) => (
                <li
                  // The daemon can repeat an identical line; the position is the only stable key.
                  key={`${index}-${line.raw}`}
                  className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-2 rounded px-1 py-0.5 hover:bg-muted/60"
                >
                  <span className="text-muted-foreground tabular-nums">{line.time || '—'}</span>
                  <span className={cn('font-semibold uppercase', LEVEL_TONE[line.level])}>
                    {t(`logs.level.${line.level}`)}
                  </span>
                  <span className="break-words">
                    {line.message}
                    {line.fields.map(([key, value]) => (
                      <span key={key} className="ml-2 text-muted-foreground">
                        {key}={value}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
