import type { QueryResult } from '@shared/query'

type CountFields = Pick<QueryResult, 'rows' | 'rowCount' | 'truncated'>

/** True when rowCount is a real total. The SQL drivers fetch the full result before
 *  capping the display, so their rowCount survives truncation; mongo's bounded fetch
 *  only knows "more than shown" (rowCount === rows.length when truncated). */
function exactTotal(r: CountFields): boolean {
  return !r.truncated || r.rowCount > r.rows.length
}

/** Status line: "1 row" / "42 rows", or "1000+ rows" when the true total is unknown. */
export function rowCountLabel(r: CountFields): string {
  const exact = exactTotal(r)
  const n = exact ? r.rowCount : r.rows.length
  return `${n}${exact ? '' : '+'} ${n === 1 ? 'row' : 'rows'}`
}

/** Feedback for a write/command result that returns no result set (columns === 0) —
 *  an UPDATE/INSERT/DELETE/DDL: the affected-row count, where `rowCount` carries the
 *  number of rows affected. "1 row affected" / "5 rows affected" / "0 rows affected"
 *  (0 is meaningful: a WHERE that matched nothing). */
export function affectedRowsLabel(r: Pick<QueryResult, 'rowCount'>): string {
  return `${r.rowCount} ${r.rowCount === 1 ? 'row' : 'rows'} affected`
}

/** Truncation chip: "showing first 1000 of 45231" when the total is known,
 *  "showing first 1000 (more available)" when it is not. Null when not truncated. */
export function truncationLabel(r: CountFields): string | null {
  if (!r.truncated) return null
  return exactTotal(r)
    ? `showing first ${r.rows.length} of ${r.rowCount}`
    : `showing first ${r.rows.length} (more available)`
}
