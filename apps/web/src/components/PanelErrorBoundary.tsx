import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

import { i18n } from '~/i18n'

interface PanelErrorBoundaryProps {
  children: ReactNode
  /** Shown above the message; lets one boundary serve the panel and the editor. */
  title?: string
}

interface PanelErrorBoundaryState {
  failed: boolean
  message: string
}

/**
 * Last line of defence for the router panel.
 *
 * The panel runs inside a LuCI iframe with no browser chrome of its own, so an
 * uncaught render error used to leave a blank page with no way back except a
 * manual reload of the LuCI page. Catching it here keeps the header and the
 * diagnostics reachable and tells the user what happened.
 *
 * This deliberately renders plain markup instead of the design system: the
 * failure may come from the very components a themed fallback would use.
 */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): PanelErrorBoundaryState {
    // Keep the message short; a stack trace belongs in the console, and the
    // router log is the place an operator actually reads.
    const message = error instanceof Error ? error.message : String(error ?? '')
    return { failed: true, message: message.slice(0, 300) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The console is the only sink available inside the iframe: there is no
    // telemetry endpoint, and inventing one would ship user config upstream.
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
