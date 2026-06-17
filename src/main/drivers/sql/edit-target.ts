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
