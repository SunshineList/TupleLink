import type { ReactNode } from 'react'
import { Component, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { i18n } from '~/i18n'

export type DaeConfigType = 'routing' | 'dns'
export interface DaeEditorProps {
  value: string
  onChange: (value: string) => void
  configType?: DaeConfigType
  height?: string | number
  disabled?: boolean
}

const Editor = lazy(() => import('./DaeEditorImpl').then((module) => ({ default: module.DaeEditor })))

class EditorBoundary extends Component<DaeEditorProps & { children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-muted-foreground">
          {i18n.t('shell.editorFailed')}
        </p>
        <textarea
          aria-label={i18n.t('shell.editorLabel')}
          className="min-h-64 w-full rounded border bg-background p-3 font-mono text-sm"
          value={this.props.value}
          disabled={this.props.disabled}
          onChange={(event) => this.props.onChange(event.target.value)}
        />
      </div>
    )
  }
}

export function DaeEditor(props: DaeEditorProps) {
  const { t } = useTranslation()
  return (
    <EditorBoundary {...props}>
      <Suspense
        fallback={
          <div role="status" className="p-4 text-sm text-muted-foreground">
            {t('shell.editorLoading')}
          </div>
        }
      >
        <Editor {...props} />
      </Suspense>
    </EditorBoundary>
  )
}
