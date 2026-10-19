import type { useLatencyTests } from '~/hooks/useLatencyTests'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

export type LatencyTests = ReturnType<typeof useLatencyTests>

export function LatencyStatus({ tests, scope }: { tests: LatencyTests; scope: string }) {
  const { t } = useTranslation()
  if (tests.scope !== scope) return null
  return (
    <>
      {tests.busy && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm" role="status" aria-live="polite">
          <span>{t('latency.progress', tests.progress)}</span>
          <Button size="sm" variant="outline" onClick={tests.stop}>
            {t('latency.stop')}
          </Button>
        </div>
      )}
      {tests.error && (
        <p role="alert" className="text-sm text-destructive">
          {tests.error}
        </p>
      )}
    </>
  )
}
