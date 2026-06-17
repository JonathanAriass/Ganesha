import type { ColumnMeta, EditableResult, RowEdit } from '@shared/query'

/** Dirty-map key: TanStack row id (original data index) + result-column index. The
 *  row-id basis means a staged edit survives re-sorting/filtering the grid. */
export function dirtyKey(rowIndex: number, colIndex: number): string {
  return `${rowIndex}:${colIndex}`
}

/** Turn the staged edits (keyed `rowId:colIndex`) into per-row edits. Each row's key
 *  columns are read from the row's cells (via columnSources); edits on null-source or
 *  key columns are ignored. */
export function buildRowEdits(
  dirty: Record<string, unknown>,
  rows: unknown[][],
  editable: EditableResult
): RowEdit[] {
  const byRow = new Map<number, RowEdit>()
  for (const [k, value] of Object.entries(dirty)) {
    const [rowIndex, colIndex] = k.split(':').map(Number)
    const realCol = editable.columnSources[colIndex]
    if (!realCol || editable.keyColumns.includes(realCol)) continue // non-editable or key cell
    let edit = byRow.get(rowIndex)
    if (!edit) {
      const key: Record<string, unknown> = {}
      for (const kc of editable.keyColumns) key[kc] = rows[rowIndex][editable.columnSources.indexOf(kc)]
      edit = { key, set: {} }
      byRow.set(rowIndex, edit)
    }
    edit.set[realCol] = value
  }
  return [...byRow.values()]
}

/** A single staged change, for the commit-confirmation review list. */
export interface EditChange {
  /** Display name of the edited table (schema-qualified when there's a schema). */
  table: string
  /** Primary-key values identifying the row. */
  key: Record<string, unknown>
  /** Edited column (display name). */
  column: string
  oldValue: unknown
  newValue: unknown
}

/** Describe the staged edits as a reviewable list (one entry per edited cell), ordered by
 *  row then column. Edits on null-source or key columns are skipped (never editable).
 *  `oldValue` reads the current result row — sound because the modal closes on a
 *  successful commit, so it never shows already-adopted values. */
export function describeEdits(
  dirty: Record<string, unknown>,
  columns: ColumnMeta[],
  rows: unknown[][],
  editable: EditableResult
): EditChange[] {
  const table = editable.table.schema ? `${editable.table.schema}.${editable.table.name}` : editable.table.name
  const out: (EditChange & { rowIndex: number })[] = []
  for (const [k, newValue] of Object.entries(dirty)) {
    const [rowIndex, colIndex] = k.split(':').map(Number)
    const realCol = editable.columnSources[colIndex]
    if (!realCol || editable.keyColumns.includes(realCol)) continue
    const row = rows[rowIndex]
    if (!row) continue
    const key: Record<string, unknown> = {}
    for (const kc of editable.keyColumns) key[kc] = row[editable.columnSources.indexOf(kc)]
    out.push({ table, key, column: columns[colIndex]?.name ?? realCol, oldValue: row[colIndex], newValue, rowIndex })
  }
  out.sort((a, b) => a.rowIndex - b.rowIndex || a.column.localeCompare(b.column))
  return out.map(({ rowIndex: _rowIndex, ...c }) => c)
}
