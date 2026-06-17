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

/** How many times `name` appears as a FROM/JOIN source in the SQL (string literals and
 *  comments stripped first). A self-join projecting *different* columns of one table is
 *  metadata-indistinguishable from a plain single-table SELECT — both show one source
 *  table — yet a result row then spans two base rows, so the row key read from the
 *  result can target the wrong row. Editing requires exactly one reference; anything
 *  else (self-join, self-referencing subquery) is refused. Conservative: a false >1
 *  only declines editing, never mis-writes. */
export function sourceTableReferenceCount(sql: string, name: string): number {
  const cleaned = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
  // Isolate the FROM clause (tables, JOINs and their ON conditions) up to the next
  // top-level keyword, so SELECT-list / WHERE mentions of the name don't count.
  const body = /\bfrom\b[\s\S]*?(?=\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\blimit\b|\boffset\b|\bunion\b|\bfetch\b|$)/i.exec(cleaned)
  if (!body) return 0
  // A table reference is the name (optionally schema-qualified / quoted) right after
  // FROM, JOIN or a comma — catching both `JOIN t` and comma-style `, t` self-joins.
  const re = new RegExp(
    String.raw`(?:\bfrom\b|\bjoin\b|,)\s*(?:(?:[\w$]+|"[^"]+"|\`[^\`]+\`)\.)?["\`]?` +
      escapeRegExp(name) +
      String.raw`["\`]?(?![\w$])`,
    'gi'
  )
  return (body[0].match(re) || []).length
}
