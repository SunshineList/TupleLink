import { useTranslation } from 'react-i18next'
import { useGeneralQuery } from '~/apis'
import { SettingsSaveState } from '~/components/SettingsSaveState'

export function CoreSettingsSaveState() {
  const { t } = useTranslation()
  const query = useGeneralQuery()
  const core = query.data?.general.dae
  return (
    <SettingsSaveState
      state={
        query.isPending
          ? 'loading'
          : query.isError
            ? 'failed'
            : core?.modified
              ? 'pending'
              : core?.running
                ? 'applied'
                : 'saved'
      }
      effect={t('saveState.coreEffect')}
    />
  )
}
