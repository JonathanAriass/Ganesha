import type { ConnectionType } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'

const SIMPLE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Default query for double-clicking a table/collection in the tree. */
export function defaultTableQuery(type: ConnectionType, ref: ObjectRef): string {
  if (type === 'mongodb') {
    return SIMPLE.test(ref.name) ? `db.${ref.name}.find({})` : `db["${ref.name}"].find({})`
  }
  if (type === 'postgres') {
    return `SELECT * FROM "${ref.schema ?? 'public'}"."${ref.name}" LIMIT 100`
  }
  return `SELECT * FROM \`${ref.name}\` LIMIT 100`
}
