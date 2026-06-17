import type { ColumnMeta, EditableResult, RowEdit } from '@shared/query'
import { parseEditKey, getAtPath } from './doc-path'

export { editKey } from './doc-path'

/** Turn the staged edits (keyed `row<SEP>fieldPath`) into per-row edits. The set is keyed
 *  by field path — a flat column name for SQL/top-level, a dotted path for nested Mongo
 *  (`address.city`, `tags.0`). Each row's key columns are read from its cells; edits on a
 *  key column are ignored. */
export function buildRowEdits(
  dirty: Record<string, unknown>,
  rows: unknown[][],
  editable: EditableResult
): RowEdit[] {
  const byRow = new Map<number, RowEdit>()
  for (const [k, value] of Object.entries(dirty)) {
    const { rowIndex, path } = parseEditKey(k)
    if (editable.keyColumns.includes(path)) continue // never edit a key column
    let edit = byRow.get(rowIndex)
    if (!edit) {
      const key: Record<string, unknown> = {}
      for (const kc of editable.keyColumns) key[kc] = rows[rowIndex][editable.columnSources.indexOf(kc)]
      edit = { key, set: {} }
      byRow.set(rowIndex, edit)
    }
    edit.set[path] = value
  }
  return [...byRow.values()]
}

/** A single staged change, for the commit-confirmation review list. */
export interface EditChange {
  /** Display name of the edited table (schema-qualified when there's a schema). */
  table: string
  /** Primary-key / _id values identifying the row. */
  key: Record<string, unknown>
  /** Edited field path (column name, or dotted path for nested Mongo). */
  column: string
  oldValue: unknown
  newValue: unknown
}

/** Describe the staged edits as a reviewable list (one entry per edited field), ordered by
 *  row then path. The old value comes from the result row for a top-level column, else from
 *  the document at the dotted path (Mongo nested). Key-column edits are skipped. */
export function describeEdits(
  dirty: Record<string, unknown>,
  columns: ColumnMeta[],
  rows: unknown[][],
  documents: Record<string, unknown>[] | null,
  editable: EditableResult
): EditChange[] {
  const table = editable.table.schema ? `${editable.table.schema}.${editable.table.name}` : editable.table.name
  const out: (EditChange & { rowIndex: number })[] = []
  for (const [k, newValue] of Object.entries(dirty)) {
    const { rowIndex, path } = parseEditKey(k)
    if (editable.keyColumns.includes(path)) continue
    const row = rows[rowIndex]
    if (!row) continue
    const key: Record<string, unknown> = {}
    for (const kc of editable.keyColumns) key[kc] = row[editable.columnSources.indexOf(kc)]
    const colIndex = columns.findIndex((c) => c.name === path)
    const oldValue = colIndex >= 0 ? row[colIndex] : getAtPath(documents?.[rowIndex], path)
    out.push({ table, key, column: path, oldValue, newValue, rowIndex })
  }
  out.sort((a, b) => a.rowIndex - b.rowIndex || a.column.localeCompare(b.column))
  return out.map(({ rowIndex: _rowIndex, ...c }) => c)
}
