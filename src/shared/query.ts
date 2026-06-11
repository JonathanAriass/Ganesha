export interface ColumnMeta {
  name: string
  dataType: string | null
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
}
