import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '~/lib/utils'

/**
 * 页内提示条。
 *
 * 为什么要有这个组件：WireGuard 绑定、分流规则顺序、日志级别这几处提示
 * 都是手写的 `rounded-lg border border-amber-500/40 bg-amber-500/10`，
 * 改一次配色要翻遍所有页面，深色模式下也容易漏改。
 *
 * 语气只有四档，别再加：
 *  - info      陈述事实，不需要动作
 *  - success   刚刚完成的操作
 *  - warning   需要用户处理，但系统仍能工作
 *  - danger    功能已经不可用
 *
 * 判据是「用户要不要做事」而不是「严重程度」。同样是黄色，
 * 「建议开启」和「必须修复」应该用不同语气，不然提示会失去区分度。
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const TONE: Record<AlertTone, { wrap: string; icon: string; Icon: LucideIcon }> = {
  info: {
    wrap: 'border-border bg-muted/50',
    icon: 'text-muted-foreground',
    Icon: Info,
  },
  success: {
    wrap: 'border-emerald-500/40 bg-emerald-500/10',
    icon: 'text-emerald-700 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  warning: {
    wrap: 'border-amber-500/40 bg-amber-500/10',
    icon: 'text-amber-800 dark:text-amber-300',
    Icon: AlertTriangle,
  },
  danger: {
    wrap: 'border-destructive/40 bg-destructive/10',
    icon: 'text-destructive',
    Icon: XCircle,
  },
}

export function AlertBanner({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone
  title?: string
  children?: React.ReactNode
  /** 主操作。只放一个 —— 多个按钮会让人不知道先点哪个。 */
  action?: { label: string; onClick: () => void }
  className?: string
}) {
  const { wrap, icon, Icon } = TONE[tone]

  return (
    <div
      // warning/danger 用 alert，其余用 status：读屏器不该为「有更新」打断用户。
      role={tone === 'warning' || tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3 text-xs', wrap, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className={cn('font-semibold', icon)}>{title}</p>}
        {children && <div className={cn('text-muted-foreground', title && 'mt-1')}>{children}</div>}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            // 36px：比 44px 的触摸下限小，但这条提示在桌面端占大头，
            // 手机上一次只出现一条，实测可点。
            className="mt-2 inline-flex h-9 items-center rounded-md border bg-background px-3 font-medium text-foreground transition-colors hover:bg-accent"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
