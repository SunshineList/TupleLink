import { useEffect } from 'react'
import { markSettingsDirty, unsavedSettingsAtom } from '~/utils/unsaved-settings'

export function useUnsavedSettings(section: string, dirty: boolean) {
  useEffect(() => {
    markSettingsDirty(section, dirty)
    return () => markSettingsDirty(section, false)
  }, [section, dirty])
}

export function useUnsavedSettingsGuard() {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!unsavedSettingsAtom.get().length) return
      event.preventDefault()
      event.returnValue = ''
    }
    // Browsers prompt for dirty child frames when the host unloads too.
    // LuCI's same-document menu/Back transitions are guarded separately before
    // changing its URL, so accepting a normal link cannot cause two prompts.
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [])
}
