import { atom } from 'nanostores'
import { i18n } from '~/i18n'

// Only section names live here. Credentials and field values stay in the form.
export const unsavedSettingsAtom = atom<string[]>([])
export function markSettingsDirty(section: string, dirty: boolean) {
  const current = unsavedSettingsAtom.get()
  if (dirty === current.includes(section)) return
  unsavedSettingsAtom.set(dirty ? [...current, section] : current.filter((name) => name !== section))
}
export function confirmDiscardSettings() {
  // LuCI navigation updates parent history synchronously, so decide before it mutates.
  // eslint-disable-next-line no-alert
  return unsavedSettingsAtom.get().length === 0 || window.confirm(i18n.t('saveState.leavePrompt'))
}
