import type { HealthLevel, RouterCheck, RouterStatus } from '~/utils/router-health'
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'
import { attentionChecks, formatPlatform, formatVersion, readChecks, summariseHealth } from '~/utils/router-health'

const LEVEL_ICON = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  unknown: CircleHelp,
} as const

const LEVEL_TONE: Record<HealthLevel, string> = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  error: 'text-destructive',
  unknown: 'text-muted-foreground',
}

const ROW_TONE: Record<RouterCheck['status'], string> = {
  ok: 'border-border/60',
  warning: 'border-amber-500/30 bg-amber-500/5',
  error: 'border-destructive/30 bg-destructive/5',
}

export function HealthDot({ level, className }: { level: HealthLevel; className?: string }) {
  const Icon = LEVEL_ICON[level]
  return <Icon aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0', LEVEL_TONE[level], className)} />
}

// Compact header summary: one chip that answers "will the proxy start, and is
// anything wrong with this firmware" without opening the diagnostics panel.
export function HealthChip({ status }: { status?: RouterStatus | null }) {
  const { t } = useTranslation()
  const health = summariseHealth(status)
  if (health.level === 'unknown') return null
  const label =
    health.level === 'ok'
      ? t('health.allGood')
      : health.level === 'error'
        ? t('health.blocked', { count: health.error })
        : t('health.warnings', { count: health.warning })
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        health.level === 'ok' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
        health.level === 'warning' && 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
        health.level === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      <HealthDot level={health.level} />
      {label}
    </span>
  )
}

function CheckRow({ check }: { check: RouterCheck }) {
  const { t } = useTranslation()
  return (
    <li className={cn('rounded-lg border p-3', ROW_TONE[check.status])}>
      <div className="flex items-start gap-2.5">
        <HealthDot level={check.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t(`health.check.${check.name}`, { defaultValue: check.name })}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground break-words">{check.message}</p>
        </div>
      </div>
    </li>
  )
}

// The router already returns a full diagnostic payload; the panel used to drop it
// on the floor, so an incompatible firmware looked identical to a healthy one
// until the user pressed Start and read the log.
export function RouterHealth({ status, className }: { status?: RouterStatus | null; className?: string }) {
  const { t } = useTranslation()
  const checks = readChecks(status)
  const health = summariseHealth(status)
  const attention = attentionChecks(status)
  const platform = formatPlatform(status)
  const version = formatVersion(status)

  if (!checks.length) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        {status ? t('health.noChecks') : t('health.unavailable')}
      </p>
    )
  }

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label={t('health.title')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <HealthDot level={health.level} className="h-4 w-4" />
        {platform && <span>{platform}</span>}
        {status?.architecture && <span className="font-mono">{status.architecture}</span>}
        {status?.kernel && <span className="font-mono">{t('health.kernel', { kernel: status.kernel })}</span>}
        {version && (
          <Badge variant="outline" className="font-mono text-[11px]">
            {version}
          </Badge>
        )}
      </div>

      {attention.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {attention.map((check) => (
            <CheckRow key={check.name} check={check} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          {t('health.allPassed', { count: health.ok })}
        </p>
      )}

      {attention.length > 0 && attention.length < checks.length && (
        <p className="text-xs text-muted-foreground">{t('health.passed', { count: health.ok })}</p>
      )}
    </section>
  )
}
