import { useTranslation } from 'react-i18next'

export function SettingsSaveState({
  state,
  effect,
}: {
  state: 'loading' | 'dirty' | 'saving' | 'failed' | 'saved' | 'pending' | 'applied'
  effect?: string
}) {
  const { t } = useTranslation()
  const tone =
    state === 'dirty' || state === 'pending'
      ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
      : state === 'failed'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground'
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
      <span className={`rounded-full px-2.5 py-1 font-medium ${tone}`}>{t(`saveState.${state}`)}</span>
      {effect && <span className="text-muted-foreground">{effect}</span>}
    </div>
  )
}
