import type { DbObject, ObjectRef, ColumnInfo } from '@shared/schema'
import { MONGO_OPS, MONGO_READ_OPS, type MongoOp } from '@shared/mongo-ops'

/** Editor-agnostic completion item; monaco-completions.ts maps these to Monaco's shape.
 *  Pure data in/out so the suggestion logic is unit-testable without monaco. */
export interface Suggestion {
  label: string
  kind: 'keyword' | 'table' | 'view' | 'collection' | 'column' | 'database' | 'op' | 'snippet'
  insertText: string
  /** insertText uses Monaco snippet placeholders ($0, ${1:x}; literal $ escaped as \$). */
  isSnippet?: boolean
  detail?: string
}

// ── SQL ──────────────────────────────────────────────────────────────────────

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
  'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN', 'LIKE', 'EXISTS',
  'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'DISTINCT',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX',
  'UNION', 'UNION ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NULL'
]

function objectSuggestion(o: DbObject): Suggestion {
  return {
    label: o.name,
    kind: o.kind === 'view' ? 'view' : o.kind === 'collection' ? 'collection' : 'table',
    // Raw name — dialect-specific identifier quoting (pg "..." vs mysql `...`)
    // is deliberately out of scope for a completion hint.
    insertText: o.name,
    detail: o.schema ?? undefined
  }
}

/** Keyword + table/view suggestions for a plain (no-dot) SQL cursor position. */
export function sqlPlainSuggestions(objects: DbObject[]): Suggestion[] {
  return [
    ...objects.map(objectSuggestion),
    ...SQL_KEYWORDS.map((k): Suggestion => ({ label: k, kind: 'keyword', insertText: k }))
  ]
}

/** "… u." / "… u.na" → "u"; null when the cursor is not right after `ident.`.
 *  Quoted identifiers ("Users".) are not recognized — unquoted-lowercase is the
 *  overwhelmingly common case in a query scratchpad. */
export function sqlDotQualifier(textBeforeCursor: string): string | null {
  const m = /([A-Za-z_][\w$]*)\.\w*$/.exec(textBeforeCursor)
  return m ? m[1] : null
}

interface TableBinding {
  ref: ObjectRef
  alias: string | null
}

// Words that can follow a table reference but are clauses, not aliases.
const NOT_ALIAS = new Set([
  'where', 'on', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'using',
  'group', 'order', 'having', 'limit', 'offset', 'union', 'set', 'as', 'when', 'and', 'or', 'not', 'returning'
])

/** FROM/JOIN bindings in the statement: `from public.users u` →
 *  { ref: { schema: 'public', name: 'users' }, alias: 'u' }. */
export function sqlTableBindings(fullText: string): TableBinding[] {
  const out: TableBinding[] = []
  const re = /\b(?:from|join)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi
  for (const m of fullText.matchAll(re)) {
    const parts = m[1].split('.')
    const ref: ObjectRef = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: null, name: parts[0] }
    const alias = m[2] && !NOT_ALIAS.has(m[2].toLowerCase()) ? m[2] : null
    out.push({ ref, alias })
  }
  return out
}

/** Map a (possibly schema-less) binding onto the known object list so the column
 *  lookup uses the same { schema, name } key the schema tree caches under. */
function lookupRef(bound: ObjectRef, objects: DbObject[]): ObjectRef {
  const name = bound.name.toLowerCase()
  const schema = bound.schema?.toLowerCase() ?? null
  const hit = objects.find(
    (o) => o.name.toLowerCase() === name && (schema === null || o.schema?.toLowerCase() === schema)
  )
  return hit ? { schema: hit.schema, name: hit.name } : bound
}

export type SqlDotContext =
  | { type: 'columns'; ref: ObjectRef }
  | { type: 'schemaObjects'; schema: string }

/** What `qualifier.` refers to: an alias or table (→ its columns), or a schema
 *  (→ its objects). Aliases win over table names win over schema names. */
export function resolveSqlQualifier(fullText: string, qualifier: string, objects: DbObject[]): SqlDotContext | null {
  const q = qualifier.toLowerCase()
  const bindings = sqlTableBindings(fullText)

  const byAlias = bindings.find((b) => b.alias?.toLowerCase() === q)
  if (byAlias) return { type: 'columns', ref: lookupRef(byAlias.ref, objects) }

  const byTable = bindings.find((b) => b.ref.name.toLowerCase() === q)
  if (byTable) return { type: 'columns', ref: lookupRef(byTable.ref, objects) }

  const schemaHit = objects.find((o) => o.schema?.toLowerCase() === q)
  if (schemaHit) return { type: 'schemaObjects', schema: schemaHit.schema! }

  // Not bound in this statement, but a known object name (e.g. typing `users.`
  // before writing the FROM clause).
  const objHit = objects.find((o) => o.name.toLowerCase() === q)
  if (objHit) return { type: 'columns', ref: { schema: objHit.schema, name: objHit.name } }

  return null
}

export function columnSuggestions(cols: ColumnInfo[]): Suggestion[] {
  return cols.map((c) => ({ label: c.name, kind: 'column', insertText: c.name, detail: c.dataType }))
}

export function schemaObjectSuggestions(objects: DbObject[], schema: string): Suggestion[] {
  return objects.filter((o) => o.schema === schema).map(objectSuggestion)
}

// ── Mongo shell ──────────────────────────────────────────────────────────────

export type MongoCursorContext =
  | { type: 'databases'; partial: string }
  /** database: null = the connection's default db (listObjects tags those schema: null). */
  | { type: 'collections'; database: string | null }
  | { type: 'ops' }

const IDENT = String.raw`[A-Za-z_$][\w$]*`
// Ordered most-specific-first; each is anchored at the cursor ($) so they can't
// shadow one another. A trailing \w* is the partial word being completed.
const RE_DATABASE = new RegExp(String.raw`\bdb\.getSiblingDB\(\s*["']([\w$-]*)$`)
const RE_SIBLING_OP = new RegExp(String.raw`\bdb\.getSiblingDB\(\s*["'][^"']+["']\s*\)\.${IDENT}\.\w*$`)
const RE_SIBLING_COLL = new RegExp(String.raw`\bdb\.getSiblingDB\(\s*["']([^"']+)["']\s*\)\.\w*$`)
const RE_OP = new RegExp(String.raw`\bdb\.${IDENT}\.\w*$`)
const RE_COLL = new RegExp(String.raw`\bdb\.\w*$`)

/** Classify the cursor position in a mongo shell command. Null = not a spot we
 *  complete (chained cursor methods, inside filters, …). */
export function mongoCursorContext(textBeforeCursor: string): MongoCursorContext | null {
  let m = RE_DATABASE.exec(textBeforeCursor)
  if (m) return { type: 'databases', partial: m[1] }
  if (RE_SIBLING_OP.test(textBeforeCursor)) return { type: 'ops' }
  m = RE_SIBLING_COLL.exec(textBeforeCursor)
  if (m) return { type: 'collections', database: m[1] }
  if (RE_OP.test(textBeforeCursor)) return { type: 'ops' }
  if (RE_COLL.test(textBeforeCursor)) return { type: 'collections', database: null }
  return null
}

/** Collections in the given database (null = default db). Only identifier-safe names —
 *  the shell subset has no getCollection()/bracket access, so `db.my-coll` can't be
 *  expressed anyway. After a plain `db.`, getSiblingDB is offered too; on a browse-all
 *  connection (no default db, every object schema-tagged) it is the only suggestion,
 *  matching the driver's refusal to run plain `db.x` there. */
export function mongoCollectionSuggestions(objects: DbObject[], database: string | null): Suggestion[] {
  const out: Suggestion[] = objects
    .filter((o) => o.schema === database && /^[A-Za-z_$][\w$]*$/.test(o.name))
    .map((o) => ({ label: o.name, kind: 'collection', insertText: o.name, detail: database ?? undefined }))
  if (database === null) {
    out.push({
      label: 'getSiblingDB',
      kind: 'snippet',
      insertText: 'getSiblingDB("${1:database}").$0',
      isSnippet: true,
      detail: 'target another database'
    })
  }
  return out
}

const MONGO_OP_SNIPPETS: Record<MongoOp, string> = {
  find: 'find({ $0 })',
  findOne: 'findOne({ $0 })',
  aggregate: 'aggregate([{ $0 }])',
  count: 'count({ $0 })',
  countDocuments: 'countDocuments({ $0 })',
  distinct: 'distinct("${1:field}")',
  insertOne: 'insertOne({ $0 })',
  insertMany: 'insertMany([{ $0 }])',
  // \\$set → literal $set ($set unescaped would parse as a snippet variable).
  updateOne: 'updateOne({ $1 }, { \\$set: { $0 } })',
  updateMany: 'updateMany({ $1 }, { \\$set: { $0 } })',
  deleteOne: 'deleteOne({ $0 })',
  deleteMany: 'deleteMany({ $0 })',
  replaceOne: 'replaceOne({ $1 }, { $0 })'
}

export function mongoOpSuggestions(): Suggestion[] {
  return MONGO_OPS.map((op) => ({
    label: op,
    kind: 'op',
    insertText: MONGO_OP_SNIPPETS[op],
    isSnippet: true,
    detail: (MONGO_READ_OPS as readonly string[]).includes(op) ? 'read' : 'write'
  }))
}

/** Database names for getSiblingDB("…") — the distinct schema tags (browse-all mode);
 *  empty on a default-db connection, which only ever lists schema: null objects. */
export function mongoDatabaseSuggestions(objects: DbObject[]): Suggestion[] {
  const names = [...new Set(objects.map((o) => o.schema).filter((s): s is string => s != null))]
  return names.map((n) => ({ label: n, kind: 'database', insertText: n }))
}
