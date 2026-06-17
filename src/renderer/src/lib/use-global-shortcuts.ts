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
        if (s.commitModal) {
          e.preventDefault()
          s.closeCommitModal()
        } else if (s.saveQueryModal) {
          e.preventDefault()
          s.closeSaveQueryModal()
        } else if (s.paletteOpen) {
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
      if (s.connectionModal || s.saveQueryModal || s.commitModal) return // overlay owns the keyboard; no chord applies
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
        case 'commit-edits': {
          // ⌘S reviews+commits staged results-grid edits — it opens the confirmation
          // modal (the actual write happens on Confirm) rather than committing silently.
          // Staged edits only exist in the per-connection "require explicit commit" mode,
          // so this naturally honours that setting. Swallowed when nothing is staged
          // (saving a query to favourites is the ☆ Save button only now).
          const tab = s.tabs.find((t) => t.id === s.activeTabId)
          if (tab && Object.keys(tab.edits).length > 0) s.openCommitModal(tab.id)
          break
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
