export interface ColumnMeta {
  name: string
  dataType: string | null
}

/** Describes how a row-returning result maps to one editable table/collection, so the
 *  grid can offer in-place edits keyed by a row identity present in the result. */
export interface EditableResult {
  table: { schema: string | null; name: string }
  /** Real base-table columns forming the row key (SQL primary key; Mongo ['_id']). */
  keyColumns: string[]
  /** Per result-column index: the real base-table column it maps to, or null for an
   *  expression/joined/computed column. Editable = non-null and not in keyColumns. */
  columnSources: (string | null)[]
}

/** One row's edit: the original key (the WHERE) and the changed columns (the SET).
 *  Values are raw cell values; the driver binds them as parameters. */
export interface RowEdit {
  key: Record<string, unknown>
  set: Record<string, unknown>
}

export interface QueryResult {
  columns: ColumnMeta[]
  rows: unknown[][]
  /** Row-returning results: the TRUE total when the driver knows it (the SQL drivers
   *  fetch the full result before display-capping). A driver that bounds the fetch
   *  itself (mongo: maxRows+1 probe) must report the SHOWN count instead — the
   *  renderer reads `truncated && rowCount === rows.length` as "total unknown"
   *  (lib/result-label.ts). Writes: the affected-row count. */
  rowCount: number
  durationMs: number
  truncated: boolean
  documents: Record<string, unknown>[] | null
  /** Present only for a result over one editable table/collection whose key is in the
   *  result. null = the grid is read-only. */
  editable: EditableResult | null
}
