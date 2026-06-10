import type { ColumnInfo } from '../../../shared/schema'

function fieldTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof Date) return 'date'
  const bsonType = (v as { _bsontype?: string })._bsontype
  if (bsonType) return bsonType.charAt(0).toLowerCase() + bsonType.slice(1)
  if (typeof v === 'object') return 'object'
  return typeof v
}

/** Infer field names/types from a sample document (Mongo has no fixed schema). */
export function inferFieldTypes(doc: Record<string, unknown> | null): ColumnInfo[] {
  if (!doc) return []
  return Object.entries(doc).map(([name, v]) => ({ name, dataType: fieldTypeName(v), nullable: true }))
}
