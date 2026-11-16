export function connectionInitials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (parts.length === 0) return '?'
  const chars =
    parts.length >= 2 ? [...parts[0]][0] + [...parts[1]][0] : [...parts[0]].slice(0, 2).join('')
  return chars.toUpperCase()
}

export function connectionModeText(c: { readOnly: boolean; requireCommit: boolean }): string {
  if (c.readOnly) return 'Read-only — writes are blocked'
  if (c.requireCommit) return 'Edits stage until you commit'
  return ''
}

/** A text name that carries the environment cue colour alone can't (e.g. the collapsed
 *  sidebar badge): `orders-prod (PROD), read-only`. */
export function connectionAccessibleName(c: { name: string; environment: string; readOnly: boolean }): string {
  const env = c.environment ? ` (${c.environment})` : ''
  return `${c.name}${env}${c.readOnly ? ', read-only' : ''}`
}

export function connectionHostText(c: { type: string; host: string; port: number }): string {
  return `${c.type} · ${c.host}:${c.port}`
}

/** Short edit-mode label for the dashboard card ('' when edits apply immediately). */
export function connectionModeShort(c: { readOnly: boolean; requireCommit: boolean }): string {
  if (c.readOnly) return 'Read-only'
  if (c.requireCommit) return 'Edits staged'
  return ''
}

/** "N tab(s) open" for the dashboard card; nothing for 0. */
export function openTabsLabel(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? '1 tab open' : `${n} tabs open`
}
