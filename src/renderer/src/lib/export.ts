import type { ColumnMeta, QueryResult } from '@shared/query'
import { jsonStringify } from './json'

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? jsonStringify(v) : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCsv(columns: ColumnMeta[], rows: unknown[][]): string {
  return [columns.map((c) => csvEscape(c.name)).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

/** Rows as an array of {column: value} objects — the JSON shape for tabular exports. */
export function toJsonObjects(columns: ColumnMeta[], rows: unknown[][]): string {
  const objects = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c.name, r[i]])))
  return jsonStringify(objects, true)
}

export function toJsonText(result: QueryResult): string {
  if (result.documents) return jsonStringify(result.documents, true)
  return toJsonObjects(result.columns, result.rows)
}

export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
