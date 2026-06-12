import type { ColumnMeta } from '@shared/query'
import { jsonStringify } from './json'

/** One field of the inspected row, projected for display. */
export interface FieldView {
  /** What the inspector renders (pretty JSON for structured values). */
  text: string
  isNull: boolean
  /** True when a JSON *string* was pretty-printed for display — flagged in the
   *  UI because the shown text is not byte-identical to the stored value. */
  formatted: boolean
  /** What Copy puts on the clipboard. For strings this is the ORIGINAL value
   *  (reformatting would change the data); for objects any text form is a
   *  serialization, so it matches the displayed pretty JSON. */
  copyText: string
}

/** Project one cell value for the inspector. */
export function fieldView(v: unknown): FieldView {
  if (v === null || v === undefined) {
    // copyText '' matches the grid's cellText projection of null.
    return { text: 'NULL', isNull: true, formatted: false, copyText: '' }
  }
  if (typeof v === 'object') {
    const pretty = jsonStringify(v, true)
    return { text: pretty, isNull: false, formatted: false, copyText: pretty }
  }
  if (typeof v === 'string') {
    // Pretty-print strings that hold a JSON document (pg json-as-text, mysql).
    // Scalars ("42", "true") parse too but formatting them is pure noise.
    const t = v.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return { text: JSON.stringify(JSON.parse(t), null, 2), isNull: false, formatted: true, copyText: v }
      } catch {
        // not JSON after all — fall through to raw
      }
    }
    return { text: v, isNull: false, formatted: false, copyText: v }
  }
  const s = String(v)
  return { text: s, isNull: false, formatted: false, copyText: s }
}

/** The whole row as a pretty {column: value} JSON object — the Copy-row shape.
 *  Duplicate column names collapse last-wins, same as the JSON export. */
export function rowJson(columns: ColumnMeta[], row: unknown[]): string {
  return jsonStringify(Object.fromEntries(columns.map((c, i) => [c.name, row[i]])), true)
}

/** Header label: position is the row's index in the CURRENT view order
 *  (sorted/filtered), -1 when the active filter hides the inspected row. */
export function positionLabel(pos: number, total: number): string {
  return pos === -1 ? 'Filtered out' : `Row ${pos + 1} of ${total}`
}
