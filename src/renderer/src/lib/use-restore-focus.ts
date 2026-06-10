import { useEffect, useRef } from 'react'

/**
 * Return focus to whatever had it before an overlay mounted. Palette and
 * settings render only while open, so mount/unmount brackets the overlay's
 * lifetime exactly — without this, closing one drops focus to <body> and a
 * keyboard user loses their place (typically the Monaco editor).
 */
export function useRestoreFocus(): void {
  // Capture during render: by effect time an autoFocus inside the overlay
  // (the palette input) already owns document.activeElement.
  const prevRef = useRef<Element | null>(null)
  if (prevRef.current === null) prevRef.current = document.activeElement

  useEffect(() => {
    return () => {
      const prev = prevRef.current
      // Only restore when focus actually fell to <body> (real unmount) —
      // under StrictMode's simulated unmount the overlay still holds focus.
      if (
        prev instanceof HTMLElement &&
        prev.isConnected &&
        (document.activeElement === null || document.activeElement === document.body)
      ) {
        prev.focus()
      }
    }
  }, [])
}
