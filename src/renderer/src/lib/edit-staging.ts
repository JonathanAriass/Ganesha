import type { EditableResult, RowEdit } from '@shared/query'

/** Dirty-map key: TanStack row id (original data index) + result-column index. The
 *  row-id basis means a staged edit survives re-sorting/filtering the grid. */
export function dirtyKey(rowIndex: number, colIndex: number): string {
  return `${rowIndex}:${colIndex}`
}

/** Turn the dirty map into per-row edits. Each row's key columns are read from the row's
 *  cells (via columnSources); dirty cells on null-source or key columns are ignored. */
export function buildRowEdits(
  dirty: Map<string, unknown>,
  rows: unknown[][],
  editable: EditableResult
): RowEdit[] {
  const byRow = new Map<number, RowEdit>()
  for (const [k, value] of dirty) {
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
