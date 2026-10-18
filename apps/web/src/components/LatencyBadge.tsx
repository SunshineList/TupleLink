import type { NodeLatencyProbeResult } from '~/apis'
import { useTranslation } from 'react-i18next'
import { cn } from '~/lib/utils'
import { formatLatencyLabel, latencyTone } from '~/utils/latency'

const tones = {
  good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  bad: 'bg-red-500/15 text-red-700 dark:text-red-300',
  unmeasured: 'bg-muted text-muted-foreground',
}

export function LatencyBadge({ result, fallback }: { result?: NodeLatencyProbeResult; fallback?: string }) {
  const { t } = useTranslation()
  const tone = latencyTone(result)
  return (
    <span
      data-latency-tone={tone}
      title={result?.testedAt ? new Date(result.testedAt).toLocaleString() : undefined}
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold tabular-nums',
        tones[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {formatLatencyLabel(result, t) || fallback || t('panel.notTested')}
    </span>
  )
}

export function LatencyLegend() {
  const { t } = useTranslation()
  return (
    <p className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('latency.colors')}>
      <span className="font-medium text-emerald-700 dark:text-emerald-300">{t('latency.good')}</span>
      <span className="font-medium text-amber-800 dark:text-amber-300">{t('latency.warning')}</span>
      <span className="font-medium text-red-700 dark:text-red-300">{t('latency.bad')}</span>
    </p>
  )
}
