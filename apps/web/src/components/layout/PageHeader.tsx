import { cn } from '~/lib/utils'

/**
 * 区块标题 + 右侧操作。
 *
 * 和 `Section` 的区别：`Section` 是一张带边框的卡片，里面通常放列表；
 * `PageHeader` 用于页面内的分区标题（比如「分流」「日志」），没有外框。
 *
 * 拆开是因为 `Orchestrate/index.tsx` 有 875 行，页头、分区标题、
 * 各种状态全堆在一起，改个标题都要往下翻很久。
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
