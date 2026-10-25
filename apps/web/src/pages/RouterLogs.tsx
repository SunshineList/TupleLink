import { useQuery } from '@tanstack/react-query'
import { ArrowDown, Pause } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'

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

export function RouterLogs() {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['router-logs'], queryFn: readRouterLogs, refetchInterval: 2000, retry: false })
  const output = useRef<HTMLPreElement>(null)
  const content = useRef<HTMLSpanElement>(null)
  const following = useRef(true)
  // Freeze what the user is reading while the bounded server tail keeps moving.
  const [history, setHistory] = useState<string | null>(null)
  const liveLogs = query.data?.logs ?? ''
  const logs = history ?? liveLogs
  const isFollowing = history === null

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
  }, [logs])

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
      {query.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t('logs.readFailed')}
          <button className="ml-2 min-h-11 px-2 underline" onClick={() => query.refetch()}>
            {t('panel.retry')}
          </button>
        </p>
      )}
      <pre
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
        className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words text-sm outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span ref={content} className="block">
          {logs || t(query.isPending ? 'logs.loading' : 'logs.empty')}
        </span>
      </pre>
    </section>
  )
}
