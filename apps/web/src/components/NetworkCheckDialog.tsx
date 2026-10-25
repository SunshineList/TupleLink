import { Copy, Loader2, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Dialog, DialogTitle } from '~/components/ui/dialog'
import { ScrollableDialogBody, ScrollableDialogContent, ScrollableDialogHeader } from '~/components/ui/scrollable-dialog'
import { useNetworkReport } from '~/hooks/useNetworkReport'
import { parseNetworkReport } from '~/utils/network-report'

// The report is the router's own text; only the section headers are lifted out so
// a long run stays navigable. Rows keep their original spacing, including the tabs
// in a resolver answer, which is why the body uses whitespace-pre-wrap.
export function NetworkCheckDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const report = useNetworkReport()
  const [copied, setCopied] = useState(false)
  const sections = useMemo(() => parseNetworkReport(report.data?.output ?? ''), [report.data])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.data?.output ?? '')
      setCopied(true)
      toast.success(t('network.copied'))
      setTimeout(setCopied, 2000, false)
    } catch {
      toast.error(t('network.failed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ScrollableDialogContent size="xl">
        <ScrollableDialogHeader>
          <DialogTitle>{t('network.title')}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t('network.description')}</p>
        </ScrollableDialogHeader>
        <ScrollableDialogBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => report.mutate()} disabled={report.isPending} aria-busy={report.isPending}>
              {report.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              {t(report.isPending ? 'network.running' : 'network.run')}
            </Button>
            {report.data && (
              <Button variant="outline" onClick={copy}>
                <Copy aria-hidden="true" />
                {copied ? t('network.copied') : t('network.copy')}
              </Button>
            )}
          </div>

          {report.isError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {t('network.failed')}
            </p>
          )}

          {report.data?.note && <p className="text-xs text-muted-foreground">{report.data.note}</p>}
          {report.data?.truncated && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{t('network.truncated')}</p>
          )}

          {!report.data && !report.isPending && !report.isError && (
            <p className="text-sm text-muted-foreground">{t('network.empty')}</p>
          )}

          {sections.map((section, index) => (
            <section key={`${index}-${section.title}`} className="flex flex-col gap-1">
              {section.title && (
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</h3>
              )}
              <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                {section.lines.join('\n')}
              </pre>
            </section>
          ))}
        </ScrollableDialogBody>
      </ScrollableDialogContent>
    </Dialog>
  )
}
