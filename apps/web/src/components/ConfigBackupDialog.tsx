import type { BackupSummary, ConfigBackup } from '~/utils/config-backup'
import type { RestoreProgress, RestoreResult } from '~/utils/config-restore'
import { CheckCircle2, Download, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { DialogTitle } from '~/components/ui/dialog'
import {
  ScrollableDialogBody,
  ScrollableDialogContent,
  ScrollableDialogFooter,
  ScrollableDialogHeader,
} from '~/components/ui/scrollable-dialog'
import { useGQLQueryClient } from '~/contexts'
import { useExportConfigBackup, useInvalidateAfterRestore } from '~/hooks/useConfigBackup'
import { backupFileName, BackupFormatError, parseBackup, summariseBackup } from '~/utils/config-backup'
import { restoreBackup } from '~/utils/config-restore'

// 刷机、换设备、重装都要从头配一遍，而安装器的备份只能整份回滚、
// 回滚失败就没得救。这里给用户一份能自己保管、能看清内容的 JSON 快照。

// 对话框本身由父组件用 <Dialog open> 包住，这里只需要关闭回调。
interface Props {
  onOpenChange: (open: boolean) => void
}

function download(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ConfigBackupDialog({ onOpenChange }: Props) {
  const { t } = useTranslation()
  const gqlClient = useGQLQueryClient()
  const invalidate = useInvalidateAfterRestore()
  const exporter = useExportConfigBackup()
  const fileInput = useRef<HTMLInputElement>(null)

  const [pendingFile, setPendingFile] = useState<{ backup: ConfigBackup, summary: BackupSummary } | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [progress, setProgress] = useState<RestoreProgress | null>(null)
  const [report, setReport] = useState<RestoreResult | null>(null)
  const [error, setError] = useState('')

  const reset = () => {
    setPendingFile(null)
    setProgress(null)
    setReport(null)
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const onExport = async () => {
    setError('')
    try {
      const { backup, summary } = await exporter.run()
      download(backupFileName(backup.exportedAt), JSON.stringify(backup, null, 2))
      toast.success(t('backup.exported', { count: summary.nodes + summary.subscriptions }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onPick = async (file: File) => {
    setError('')
    setReport(null)
    setPendingFile(null)
    try {
      const backup = parseBackup(await file.text())
      setPendingFile({ backup, summary: summariseBackup(backup) })
    } catch (cause) {
      setError(cause instanceof BackupFormatError ? t(cause.message, { defaultValue: t('backup.unreadable') }) : t('backup.unreadable'))
    }
  }

  const onRestore = async () => {
    if (!pendingFile) return
    setRestoring(true)
    setError('')
    setReport(null)
    try {
      const result = await restoreBackup(gqlClient, pendingFile.backup, setProgress)
      setReport(result)
      invalidate()
      if (result.warnings.length) toast.error(t('backup.restoredWithWarnings', { count: result.warnings.length }))
      else toast.success(t('backup.restored', { count: result.created }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRestoring(false)
      setProgress(null)
    }
  }

  const close = () => {
    reset()
    onOpenChange(false)
  }

  return (
    <ScrollableDialogContent size="xl">
      <ScrollableDialogHeader>
        <DialogTitle>{t('backup.title')}</DialogTitle>
      </ScrollableDialogHeader>
      <ScrollableDialogBody className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('backup.description')}</p>

        <section className="flex flex-col gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">{t('backup.exportTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('backup.exportHint')}</p>
          <Button
            className="min-h-11 self-start"
            disabled={exporter.pending}
            onClick={() => void onExport()}
          >
            {exporter.pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {t(exporter.pending ? 'backup.exporting' : 'backup.export')}
          </Button>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">{t('backup.importTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('backup.importHint')}</p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onPick(file)
            }}
          />
          <Button
            variant="outline"
            className="min-h-11 self-start"
            disabled={restoring}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {t('backup.choose')}
          </Button>

          {pendingFile && (
            <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">
                {t('backup.preview', {
                  configs: pendingFile.summary.configs,
                  routings: pendingFile.summary.routings,
                  dnss: pendingFile.summary.dnss,
                  groups: pendingFile.summary.groups,
                  nodes: pendingFile.summary.nodes,
                  subscriptions: pendingFile.summary.subscriptions,
                })}
              </p>
              <p className="text-muted-foreground">{t('backup.mergeHint')}</p>
              <Button
                className="min-h-11 self-start"
                disabled={restoring}
                onClick={() => void onRestore()}
              >
                {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {restoring
                  ? t('backup.restoring', { done: progress?.done ?? 0, total: progress?.total ?? 0 })
                  : t('backup.restore')}
              </Button>
            </div>
          )}
        </section>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </p>
        )}

        {report && (
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs">
            <p className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('backup.reportCreated', { count: report.created })}
            </p>
            {report.reused > 0 && <p className="text-muted-foreground">{t('backup.reportReused', { count: report.reused })}</p>}
            {report.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-amber-800 dark:text-amber-300">
                {report.warnings.map((warning) => (
                  <li key={warning} className="break-words">
                    {warning}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </ScrollableDialogBody>
      <ScrollableDialogFooter>
        <Button variant="outline" className="min-h-11" onClick={close}>
          {t('backup.close')}
        </Button>
      </ScrollableDialogFooter>
    </ScrollableDialogContent>
  )
}
