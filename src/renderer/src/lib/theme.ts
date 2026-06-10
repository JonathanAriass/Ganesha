import type { AppSettings } from '@shared/domain'
import { monaco, MONACO_THEME } from './monaco'

const THEME_HINT_KEY = 'theme-hint'

/**
 * Settings arrive async over IPC; this localStorage hint lets the very first
 * paint match the saved theme. The sqlite setting stays the source of truth —
 * applyTheme() rewrites the hint on every change.
 */
export function themeHint(): AppSettings['theme'] {
  return localStorage.getItem(THEME_HINT_KEY) === 'light' ? 'light' : 'midnight'
}

export function applyTheme(theme: AppSettings['theme']): void {
  document.documentElement.dataset.theme = theme
  monaco.editor.setTheme(MONACO_THEME[theme])
  localStorage.setItem(THEME_HINT_KEY, theme)
}
