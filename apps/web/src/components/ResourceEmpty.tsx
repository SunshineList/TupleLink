import { Inbox } from 'lucide-react'
import { cn } from '~/lib/utils'
import { Button } from './ui/button'

export function ResourceEmpty({
  title,
  description,
  action,
  onAction,
  className,
}: {
  title: string
  description: string
  action: string
  onAction: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-center',
        className,
      )}
    >
      <Inbox aria-hidden="true" className="mb-1 h-6 w-6 text-muted-foreground" />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}
