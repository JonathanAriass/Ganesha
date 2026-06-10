import { useEffect } from 'react'
import { useAppStore } from '../state/store'
import { resolveShortcut } from './shortcuts'

/**
 * App-wide keyboard shortcuts. Registered on the capture phase so our chords
 * win over Monaco's own keybindings (it owns a ⌘K chord) while an editor is
 * focused. ⌘W with no tabs is deliberately swallowed — accidental window
 * close from muscle memory is worse; Shift+⌘W still closes the window.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const s = useAppStore.getState()

      if (e.key === 'Escape') {
        // Only intercept when an overlay is up — Monaco needs Escape otherwise.
        if (s.paletteOpen) {
          e.preventDefault()
          s.setPaletteOpen(false)
        } else if (s.settingsOpen) {
          e.preventDefault()
          s.closeSettings()
        }
        return
      }

      const action = resolveShortcut(e)
      if (!action) return

      // While an overlay is up, only its own toggle applies — ⌘W must not
      // close a tab hidden behind the settings modal.
      if (s.settingsOpen && action !== 'settings') return
      if (s.paletteOpen && action !== 'palette') return

      e.preventDefault()
      e.stopPropagation()
      switch (action) {
        case 'palette':
          s.setPaletteOpen(!s.paletteOpen)
          break
        case 'settings':
          if (s.settingsOpen) s.closeSettings()
          else s.openSettings()
          break
        case 'new-tab':
          if (s.activeConnectionId) s.openQueryTab({ connectionId: s.activeConnectionId })
          break
        case 'close-tab':
          if (s.activeTabId) s.closeTab(s.activeTabId)
          break
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
