import type { EditableResult } from '../../../shared/query'

export interface TableId {
  schema: string | null
  name: string
}
export interface PerColumnSource {
  table: TableId | null
  column: string | null
}

function sameTable(a: TableId, b: TableId): boolean {
  return a.name === b.name && a.schema === b.schema
}

/** Assemble an EditableResult from each result column's resolved source and the source
 *  table's primary-key columns. Returns null (read-only) unless the result maps to
 *  exactly one source table whose full primary key is present among the columns. */
export function buildEditableResult(perColumn: PerColumnSource[], pkColumns: string[]): EditableResult | null {
  const tables = perColumn.map((c) => c.table).filter((t): t is TableId => t !== null)
  if (tables.length === 0) return null
  const table = tables[0]
  if (!tables.every((t) => sameTable(t, table))) return null
  if (pkColumns.length === 0) return null

  const columnSources = perColumn.map((c) => (c.table && sameTable(c.table, table) ? c.column : null))
  if (!pkColumns.every((pk) => columnSources.includes(pk))) return null

  // A duplicated source column means the same base column is projected twice — the
  // hallmark of a self-join (`t a, t b`), where one result row spans two base rows and
  // the key is ambiguous. Refuse (read-only) rather than risk writing the wrong row.
  const present = columnSources.filter((c): c is string => c !== null)
  if (new Set(present).size !== present.length) return null

  return { table, keyColumns: pkColumns, columnSources }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A CTE introducer `WITH [RECURSIVE] <name> [(cols…)] AS …` ANYWHERE in the statement
 *  (not start-anchored, so a leading `;`/`(`/comment can't smuggle one past). `GROUP BY …
 *  WITH ROLLUP` has no `<name> AS` and is not matched. `WITH ORDINALITY AS alias` does
 *  match — that's fine: it attaches to a set-returning function and multiplies rows, so
 *  those results are correctly non-editable anyway (do NOT narrow this to require `AS (`,
 *  which would re-admit row-multiplying results as editable). */
const CTE_INTRODUCER = /\bwith\b\s+(?:recursive\s+)?(?:[a-z_$][\w$]*|"[^"]+")\s*(?:\([^)]*\))?\s+as\b/i

/** Whether the SQL provably scans the base table `name` exactly once, so a result row
 *  maps to exactly one base row and a row-key edit can't target the wrong row.
 *
 *  A self-join is metadata-indistinguishable from a plain single-table SELECT — the
 *  result columns all report provenance to the one physical table (pg `tableID`, mysql
 *  `orgTable`), even through a CTE alias or a derived table — yet one result row then
 *  spans two base rows. So this string check, not the metadata, is what catches it:
 *   - **CTE present** (`WITH … AS (…)`): refuse. A CTE can be self-joined on its alias
 *     (`FROM c a JOIN c b`), which counting the base-table name can never see.
 *   - otherwise the base table must be referenced exactly once after FROM/JOIN/comma
 *     across the WHOLE statement (subqueries included — a derived-table self-join hides
 *     one reference inside a subquery).
 *  Conservative by design: it only ever declines editing, never mis-writes. */
export function isSingleTableScan(sql: string, name: string): boolean {
  const cleaned = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
  if (CTE_INTRODUCER.test(cleaned)) return false
  // A table reference is the name (optionally schema-qualified / quoted) right after
  // FROM, JOIN or a comma — catching `JOIN t`, comma-style `, t`, and references nested
  // in subqueries (we scan the whole statement, not just the first FROM clause).
  const re = new RegExp(
    String.raw`(?:\bfrom\b|\bjoin\b|,)\s*(?:(?:[\w$]+|"[^"]+"|\`[^\`]+\`)\.)?["\`]?` +
      escapeRegExp(name) +
      // A trailing `.` means this is a column/schema qualifier (`, t.id`, `from t.x`), not
      // a table reference — exclude it so a table-qualified select list isn't miscounted.
      String.raw`["\`]?(?![\w$.])`,
    'gi'
  )
  return (cleaned.match(re) || []).length === 1
}
