export type ShortcutAction = 'palette' | 'new-tab' | 'close-tab' | 'settings'

export interface KeyChord {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Map a keydown to an app action. Meta on macOS, Ctrl elsewhere — both accepted.
 * Shift chords are rejected on purpose: Shift+Cmd+W remains the menu's
 * window-close accelerator (src/main/menu.ts).
 */
export function resolveShortcut(e: KeyChord): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.altKey || e.shiftKey) return null
  switch (e.key.toLowerCase()) {
    case 'k':
      return 'palette'
    case 't':
      return 'new-tab'
    case 'w':
      return 'close-tab'
    case ',':
      return 'settings'
    default:
      return null
  }
}
