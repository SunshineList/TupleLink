import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

import { i18n } from '~/i18n'

interface PanelErrorBoundaryProps {
  children: ReactNode
  /** 显示在消息上方的标题；让同一个边界同时服务面板和编辑器。 */
  title?: string
}

interface PanelErrorBoundaryState {
  failed: boolean
  message: string
}

/**
 * 路由器面板的最后一道防线。
 *
 * 面板跑在 LuCI iframe 里，没有自己的浏览器外壳，
 * 所以一个未捕获的渲染错误过去会留下一个空白页面，
 * 除了手动刷新 LuCI 页面之外无路可回。
 * 在这里捕获它，可以让页头和诊断入口保持可用，
 * 并且告诉用户到底发生了什么。
 *
 * 这里刻意用原生 markup 而不是设计系统的组件来渲染降级 UI：
 * 故障可能恰恰来自带主题的降级 UI 自己要用的那些组件。
 */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): PanelErrorBoundaryState {
    // 消息保持简短；堆栈属于控制台，而运维真正会读的是路由器日志。
    const message = error instanceof Error ? error.message : String(error ?? '')
    return { failed: true, message: message.slice(0, 300) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // iframe 里可用的只有控制台这一个日志出口：没有遥测端点，
    // 凭空造一个等于把用户配置送到上游去。
    console.error('Panel render failed:', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const title = this.props.title ?? i18n.t('shell.crashed')
    return (
      <div role="alert" className="mx-auto flex max-w-xl flex-col gap-3 p-6 text-sm">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground">{i18n.t('shell.crashedHint')}</p>
        {this.state.message && (
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">
            {this.state.message}
          </pre>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 font-medium"
            onClick={() => this.setState({ failed: false, message: '' })}
          >
            {i18n.t('shell.crashedRetry')}
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 font-medium"
            onClick={() => window.location.reload()}
          >
            {i18n.t('shell.crashedReload')}
          </button>
        </div>
      </div>
    )
  }
}
