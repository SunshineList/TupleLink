import { useTranslation } from 'react-i18next'
import { useTestNodeUDPMutation } from '~/apis'
import { LatencyBadge } from './LatencyBadge'
import { Button } from './ui/button'

/** Mounted only inside node details; never adds polling or background probes. */
export function NodeUDPTest({ id }: { id: string }) {
  const { t } = useTranslation()
  const test = useTestNodeUDPMutation()
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">{t('udpTest.title')}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">{t('udpTest.hint')}</p>
        <Button
          className="min-h-11"
          variant="outline"
          loading={test.isPending}
          disabled={test.isPending}
          onClick={() => test.mutate(id)}
        >
          {t('udpTest.action')}
        </Button>
        <div role="status" aria-live="polite" className="space-y-2">
          {test.data && !test.isPending && !test.error && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span>{t('udpTest.result')}</span>
                <LatencyBadge result={test.data} />
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {t('udpTest.target', { target: test.data.target })}
              </p>
              <p className="text-xs text-muted-foreground">{new Date(test.data.testedAt).toLocaleString()}</p>
            </>
          )}
          {test.error && <p className="text-destructive">{t('udpTest.error')}</p>}
        </div>
      </div>
    </details>
  )
}
