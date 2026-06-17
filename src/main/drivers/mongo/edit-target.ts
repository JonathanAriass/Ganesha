import type { ColumnMeta, EditableResult } from '../../../shared/query'

/** Editable descriptor for a Mongo find/findOne result over one collection: every
 *  top-level field is editable, keyed by `_id`. Null when `_id` is not in the result
 *  (no way to target the document). */
export function mongoEditable(
  columns: ColumnMeta[],
  table: { schema: string | null; name: string }
): EditableResult | null {
  const names = columns.map((c) => c.name)
  if (!names.includes('_id')) return null
  return { table, keyColumns: ['_id'], columnSources: names }
}
