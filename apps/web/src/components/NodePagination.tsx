import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

export function NodePagination({
  page,
  pages,
  onChange,
  disabled,
}: {
  page: number
  pages: number
  onChange: (page: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('panel.nodePages')} className="flex shrink-0 items-center justify-center gap-1 border-t pt-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('panel.firstPage')}
        disabled={disabled || page === 0}
        onClick={() => onChange(0)}
      >
        <ChevronFirst />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('panel.previousPage')}
        disabled={disabled || page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <label className="flex min-w-0 items-center gap-1 text-sm tabular-nums">
        <span className="sr-only">{t('panel.jumpPage')}</span>
        <select
          className="panel-select !w-auto !min-h-9"
          value={page}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          {Array.from({ length: pages }, (_, index) => (
            <option key={index} value={index}>
              {index + 1}
            </option>
          ))}
        </select>
        <span>/ {pages}</span>
      </label>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('panel.nextPage')}
        disabled={disabled || page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('panel.lastPage')}
        disabled={disabled || page >= pages - 1}
        onClick={() => onChange(pages - 1)}
      >
        <ChevronLast />
      </Button>
    </nav>
  )
}
