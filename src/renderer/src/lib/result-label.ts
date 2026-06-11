import type { QueryResult } from '@shared/query'

type CountFields = Pick<QueryResult, 'rows' | 'rowCount' | 'truncated'>

/** True when rowCount is a real total. The SQL drivers fetch the full result before
 *  capping the display, so their rowCount survives truncation; mongo's bounded fetch
 *  only knows "more than shown" (rowCount === rows.length when truncated). */
function exactTotal(r: CountFields): boolean {
  return !r.truncated || r.rowCount > r.rows.length
}

/** Status line: "42 rows", or "1000+ rows" when the true total is unknown. */
export function rowCountLabel(r: CountFields): string {
  return exactTotal(r) ? `${r.rowCount} rows` : `${r.rows.length}+ rows`
}

/** Truncation chip: "showing first 1000 of 45231" when the total is known,
 *  "showing first 1000 (more available)" when it is not. Null when not truncated. */
export function truncationLabel(r: CountFields): string | null {
  if (!r.truncated) return null
  return exactTotal(r)
    ? `showing first ${r.rows.length} of ${r.rowCount}`
    : `showing first ${r.rows.length} (more available)`
}
