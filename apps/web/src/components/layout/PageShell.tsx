import { cn } from '~/lib/utils'

/**
 * 页面外壳：统一页面的边距、最大宽度和响应式断点。
 *
 * 为什么需要：现在每个页面各自写 `p-5`、`gap-3`、`max-h-[65dvh]` 这类魔法值，
 * 9 个页面里散落着十几套间距。改一次手机端留白要翻遍所有文件，
 * 而且很容易改漏——`RouterLogs` 和 `Orchestrate` 的 padding 就已经不一致了。
 *
 * `aside` 是右侧栏：桌面并排，窄屏自动掉到主内容下方。
 * 这样「状态摘要 + 主操作」在手机上不会挤成两列。
 */
export function PageShell({
  title,
  description,
  actions,
  aside,
  children,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  /** 页头右侧的操作按钮组。 */
  actions?: React.ReactNode
  /** 右侧栏。给了才启用两栏布局。 */
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const hasAside = aside !== undefined && aside !== null

  return (
    <div className={cn('mx-auto w-full max-w-2xl p-3 sm:p-5', hasAside && 'lg:max-w-[1400px]', className)}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3 sm:mb-5">
          <div className="min-w-0">
            {title && <h1 className="text-lg font-semibold sm:text-xl">{title}</h1>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {hasAside ? (
        // 桌面右侧栏固定 320px：再宽会把主内容压到需要横向滚动。
        <div className="grid gap-3 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{children}</div>
          <aside className="min-w-0 space-y-3">{aside}</aside>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
