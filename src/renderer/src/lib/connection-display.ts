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

export function connectionHostText(c: { type: string; host: string; port: number }): string {
  return `${c.type} · ${c.host}:${c.port}`
}
