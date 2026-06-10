import type { ColumnMeta, QueryResult } from '@shared/query'

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCsv(columns: ColumnMeta[], rows: unknown[][]): string {
  return [columns.map((c) => csvEscape(c.name)).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

export function toJsonText(result: QueryResult): string {
  if (result.documents) return JSON.stringify(result.documents, null, 2)
  const objects = result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c.name, r[i]])))
  return JSON.stringify(objects, null, 2)
}

export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
