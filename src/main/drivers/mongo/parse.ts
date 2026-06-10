import type { MongoCommand } from './command'
import { parseMongoJson } from './raw'
import { parseMongoShell } from './shell'

/** Auto-detect the Mongo query input: `db.…` → shell syntax, otherwise raw-JSON. */
export function parseMongoQuery(text: string): MongoCommand {
  const trimmed = text.trim()
  return trimmed.startsWith('db.') ? parseMongoShell(trimmed) : parseMongoJson(trimmed)
}
