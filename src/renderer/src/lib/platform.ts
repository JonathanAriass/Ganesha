/**
 * Platform detection for the sandboxed renderer (no Node APIs here).
 * Drives shortcut *hints* only — resolveShortcut accepts both meta and ctrl,
 * so the chords themselves are already cross-platform.
 */
export const isMac = /mac/i.test(navigator.platform || navigator.userAgent)

/** Modifier prefix for human-readable hints: "⌘T" on mac, "Ctrl+T" elsewhere. */
export const mod = isMac ? '⌘' : 'Ctrl+'
