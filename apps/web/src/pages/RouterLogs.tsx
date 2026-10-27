import type { LogLevel } from '~/utils/log-lines'
import type { ExitKind, RoutingDecision } from '~/utils/routing-decisions'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, Pause } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { parseLogLines } from '~/utils/log-lines'
import { exitGroupOf, hasRoutingTrace, parseDecision, summarizeDecisions } from '~/utils/routing-decisions'

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

// 出口配色沿用「严重程度」的语义：代理是常态不强调，阻断和直连需要一眼分开。
const EXIT_TONE: Record<ExitKind, string> = {
  proxy: 'text-sky-800 dark:text-sky-300',
  direct: 'text-muted-foreground',
  must_direct: 'text-muted-foreground',
  block: 'text-red-700 dark:text-red-300',
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
  // 候选列表是 dae 的调试输出，一条能占 50 行；默认折叠，需要时展开。
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  // 空集合表示「全部级别」，避免默认就把某档藏起来。
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set())
  const [search, setSearch] = useState('')
  // 第三个视图：把路由记录聚合成「域名 → 出口」，不用再一行行翻。
  const [view, setView] = useState<'structured' | 'raw' | 'decisions'>('structured')
  const liveLogs = query.data?.logs ?? ''
  const logs = history ?? liveLogs
  const isFollowing = history === null
  const parsed = useMemo(() => parseLogLines(logs), [logs])
  // 级别筛选 + 关键字筛选。dae 每几秒就重选一次 dialer，健康的 info 行会把
  // 真正的 warning 冲走，所以「只看问题」是最常用的档位。
  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return parsed.filter((line) => {
      if (levels.size && !levels.has(line.level)) return false
      if (!needle) return true
      return line.raw.toLowerCase().includes(needle)
    })
  }, [parsed, levels, search])

  // 分流视图用的数据。based on `parsed` 而不是过滤后的 lines：
  // 用户把级别筛到「只看问题」时，debug 的路由记录会被过滤掉，
  // 但分流视图仍然应该显示它自己的内容。
  const decisions = useMemo(
    () => summarizeDecisions(parsed.map((line) => parseDecision(line.raw)).filter((item) => item !== null)),
    [parsed],
  )
  // 区分「没开 debug」和「真的没有流量」：前者要给出改级别的指引，
  // 后者只是暂时没数据，说错方向会让人白折腾一圈。
  const routingTraced = useMemo(() => hasRoutingTrace(parsed.map((line) => line.raw)), [parsed])
  const hidden = parsed.length - lines.length
  const onlyProblems = levels.size === 3 && levels.has('warning') && levels.has('error') && levels.has('fatal')

  // 群组名直接显示原文（大小写敏感，改了就对不上配置）；
  // direct / block 才翻译成界面语言。
  function exitLabel(item: RoutingDecision): string {
    const group = exitGroupOf(item.kind)
    if (group === 'proxy') return item.target
    if (group === 'block') return t('logs.exitBlock')
    return t('logs.exitDirect')
  }

  function toggleLevel(level: LogLevel) {
    setLevels((current) => {
      const next = new Set(current)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  function toggleProblemsOnly() {
    setLevels(onlyProblems ? new Set() : new Set<LogLevel>(['warning', 'error', 'fatal']))
  }

  // 过滤后条数给个上限说明：日志是环形缓冲，总数不是全部历史。
  const levelCountLabel =
    hidden > 0
      ? t('logs.countFiltered', { shown: lines.length, total: parsed.length })
      : t('logs.count', { count: parsed.length })

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
  }, [logs, view])

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
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            aria-label={t('logs.search')}
            className="h-8 w-full min-w-0 rounded-lg border bg-background px-2.5 text-xs sm:w-56"
            spellCheck={false}
          />
          <div className="flex gap-1 rounded-lg border p-0.5" role="group" aria-label={t('logs.view')}>
            {(['structured', 'raw', 'decisions'] as const).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={view === item ? 'secondary' : 'ghost'}
                aria-pressed={view === item}
                className="h-8"
                onClick={() => setView(item)}
              >
                {t(
                  item === 'raw' ? 'logs.viewRaw' : item === 'decisions' ? 'logs.viewDecisions' : 'logs.viewStructured',
                )}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant={onlyProblems ? 'secondary' : 'ghost'}
            aria-pressed={onlyProblems}
            className="h-8"
            onClick={toggleProblemsOnly}
          >
            {t('logs.onlyProblems')}
          </Button>
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
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label={t('logs.legend')}>
        {(['debug', 'info', 'warning', 'error'] as const).map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={levels.has(level)}
            onClick={() => toggleLevel(level)}
            className={cn(
              'rounded-md px-1.5 py-0.5 font-semibold uppercase transition-colors',
              LEVEL_TONE[level],
              levels.has(level) ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/60',
            )}
          >
            {t(`logs.level.${level}`)}
          </button>
        ))}
        <span className="ml-auto tabular-nums text-muted-foreground">{levelCountLabel}</span>
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
          {view === 'decisions' ? (
            decisions.length === 0 ? (
              // 没有路由记录时，最可能的原因是日志级别停在 info。
              // 这种情况必须说清楚「去改级别」，否则用户会以为分流真的没跑。
              <p className="text-muted-foreground">
                {routingTraced ? t('logs.decisionsEmpty') : t('logs.decisionsNeedDebug')}
              </p>
            ) : (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">{t('logs.decisionsHint')}</p>
                {/* 宽屏用表格，窄屏用卡片：域名普遍很长（cdn-xxx.example.com），
                    两列表格在手机上会把出口列挤成省略号，反而看不出结论。 */}
                <table className="hidden w-full table-fixed border-collapse text-xs sm:table">
                  <caption className="sr-only">{t('logs.decisionsTitle')}</caption>
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th scope="col" className="w-1/2 px-1 py-1 font-medium">
                        {t('logs.decisionsColumnDomain')}
                      </th>
                      <th scope="col" className="px-1 py-1 font-medium">
                        {t('logs.decisionsColumnExit')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {decisions.map((item) => {
                      const label = exitLabel(item)
                      return (
                        <tr
                          key={`${item.domain || item.host}-${item.target}`}
                          className="border-t border-border/60 hover:bg-muted/60"
                        >
                          <td className="truncate px-1 py-1" title={item.domain || item.host}>
                            {item.domain || item.host || '—'}
                          </td>
                          <td className={cn('truncate px-1 py-1 font-semibold', EXIT_TONE[item.kind])} title={label}>
                            {label}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <ul className="space-y-1 font-mono text-xs sm:hidden">
                  {decisions.map((item) => {
                    const label = exitLabel(item)
                    return (
                      <li
                        key={`${item.domain || item.host}-${item.target}`}
                        className="flex items-baseline justify-between gap-2 rounded border-b border-border/60 px-1 py-1.5"
                      >
                        <span className="min-w-0 truncate" title={item.domain || item.host}>
                          {item.domain || item.host || '—'}
                        </span>
                        <span className={cn('shrink-0 font-semibold', EXIT_TONE[item.kind])}>{label}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          ) : lines.length === 0 ? (
            <p className="text-muted-foreground">
              {query.isPending
                ? t('logs.loading')
                : hidden
                  ? t('logs.emptyFiltered', { count: hidden })
                  : t('logs.empty')}
            </p>
          ) : view === 'raw' ? (
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
                  <span className="min-w-0 break-words">
                    {line.message}
                    {line.fields.map(([key, value]) => (
                      <span key={key} className="ml-2 text-muted-foreground">
                        {key}={value}
                      </span>
                    ))}
                    {line.detail && (
                      <button
                        type="button"
                        className="ml-2 text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                        aria-expanded={expanded.has(index)}
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current)
                            if (next.has(index)) next.delete(index)
                            else next.add(index)
                            return next
                          })
                        }
                      >
                        {expanded.has(index)
                          ? t('logs.collapseDetail')
                          : t('logs.expandDetail', { count: line.detail.length })}
                      </button>
                    )}
                    {line.detail && expanded.has(index) && (
                      <span className="mt-1 block whitespace-pre-wrap text-muted-foreground">
                        {line.detail.join('\n')}
                      </span>
                    )}
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
