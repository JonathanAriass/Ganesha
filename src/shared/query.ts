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
  /** Row-returning results only: more rows are cached in main past the ones returned here,
   *  fetchable page-by-page via `query.fetchMore`. Absent/false = this is everything (up to
   *  the hard cap; `truncated` still flags rows dropped beyond it). */
  hasMore?: boolean
}

/** A per-column constraint: an operator against one result column (`column` is its index).
 *  `contains`/`ncontains` = substring / not-substring; `eq`/`ne` = equals (numeric when both sides
 *  are numbers, else string); `gt`/`lt`/`ge`/`le` = numeric comparison. */
export type ColumnOp = 'contains' | 'ncontains' | 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le'
export interface ColumnFilter {
  column: number
  op: ColumnOp
  value: string
}

/** A results-filter query: the raw box text + toggle modes (the global, any-column part) plus any
 *  per-column constraints. In `regex` mode `text` is a single regex tested per cell; otherwise
 *  `text` is parsed into terms (space = AND, `OR` = OR, `-term`/`!term` = negate, `"quoted"`). A row
 *  matches when the global part matches AND every column constraint holds. */
export interface FilterQuery {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  columns: ColumnFilter[]
}

/** Stable identity of a filter query, for the store's race guard + as the fetch key. */
export function filterKey(q: FilterQuery): string {
  return JSON.stringify([q.text, q.caseSensitive, q.wholeWord, q.regex, q.columns])
}

/** Parse a filter-row / box-syntax column value into an op + value: a leading `>=` `<=` `>` `<` `=`
 *  `!=` or `!` (not-contains), else plain `contains`. Null when there's nothing to match on. Shared
 *  so the renderer can build ColumnFilters and main can (re)use it. */
export function parseColumnInput(input: string): { op: ColumnOp; value: string } | null {
  const m = input.trim().match(/^(>=|<=|!=|>|<|=|!)?\s*(.*)$/)
  const opTok = m?.[1] ?? ''
  const value = (m?.[2] ?? '').trim()
  if (value === '') return null
  const op: ColumnOp =
    opTok === '>=' ? 'ge' : opTok === '<=' ? 'le' : opTok === '>' ? 'gt' : opTok === '<' ? 'lt'
    : opTok === '=' ? 'eq' : opTok === '!=' ? 'ne' : opTok === '!' ? 'ncontains' : 'contains'
  return { op, value }
}

/** Turn a per-column input map (colIndex → raw input) into constraints, dropping blank inputs and
 *  sorting by column so the filter key is stable regardless of typing order. */
export function buildColumnFilters(map: Record<number, string>): ColumnFilter[] {
  return Object.entries(map)
    .map(([col, input]) => {
      const p = parseColumnInput(input)
      return p ? { column: Number(col), op: p.op, value: p.value } : null
    })
    .filter((c): c is ColumnFilter => c !== null)
    .sort((a, b) => a.column - b.column)
}
