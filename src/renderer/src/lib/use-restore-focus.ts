import { useEffect } from 'react'

/**
 * Return focus to whatever had it before an overlay mounted. Palette and
 * settings render only while open, so mount/unmount brackets the overlay's
 * lifetime exactly — without this, closing one drops focus to <body> and a
 * keyboard user loses their place (typically the Monaco editor).
 */
export function useRestoreFocus(): void {
  useEffect(() => {
    const prev = document.activeElement
    return () => {
      // The previous element may be gone by now (e.g. its tab was closed).
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus()
    }
  }, [])
}
