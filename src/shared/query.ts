export interface ColumnMeta {
  name: string
  dataType: string | null
}
export interface QueryResult {
  columns: ColumnMeta[]
  rows: unknown[][]
  rowCount: number
  durationMs: number
  truncated: boolean
  documents: Record<string, unknown>[] | null
}
