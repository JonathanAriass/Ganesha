import type { DbObject, ColumnInfo } from '../../shared/schema'

const DEFAULT_BUDGET = 6000

/** Render the connection schema as a compact, dialect-tagged summary for the
 *  system prompt. Truncates to a char budget so a huge schema can't blow the
 *  model's context window. */
export function buildSchemaContext(
  dialect: string,
  objects: { object: DbObject; columns: ColumnInfo[] }[],
  maxChars = DEFAULT_BUDGET,
  priority: string[] = []
): string {
  const header = `Database dialect: ${dialect}.`
  if (objects.length === 0) return `${header}\n(no tables found)`

  // List the focus tables (the ones the query targets) FIRST, so a large schema's truncation can't
  // drop them — "read the tables first" only helps if the right tables are present.
  const ordered = orderByPriority(objects, priority)

  // Complete roster of table NAMES — always present and compact — so the model knows exactly which
  // tables exist and never fabricates a name (e.g. `01_companies_users`) for one it can't see.
  const rosterLine = `All tables (${objects.length}): ${capList(ordered.map(({ object }) => qualify(object)), ROSTER_BUDGET)}`

  // Full columns for as many tables as the budget allows (focus tables lead).
  let body = ''
  let truncated = false
  for (const { object, columns } of ordered) {
    const cols = columns.map((c) => `${c.name} ${c.dataType}${c.nullable ? '' : ' not null'}`).join(', ')
    const line = `${qualify(object)}(${cols})`
    if (body.length + line.length + 1 > maxChars) { truncated = true; break }
    body += line + '\n'
  }
  const marker = truncated ? '… (more table columns omitted — every table name is in the list above)\n' : ''
  return `${header}\n${rosterLine}\nColumns:\n${body}${marker}`.trimEnd()
}

function qualify(object: DbObject): string {
  return object.schema && object.schema !== 'public' ? `${object.schema}.${object.name}` : object.name
}

const ROSTER_BUDGET = 8000

/** Join `names` with ', ' until `budget` chars, then summarise the remainder as `… +N more`. */
function capList(names: string[], budget: number): string {
  const parts: string[] = []
  let len = 0
  for (let i = 0; i < names.length; i++) {
    const add = (parts.length ? 2 : 0) + names[i].length
    if (len + add > budget) return `${parts.join(', ')}, … +${names.length - i} more`
    parts.push(names[i])
    len += add
  }
  return parts.join(', ')
}

/** Move the named tables to the front (preserving their given order), keeping the rest in place. */
function orderByPriority(
  objects: { object: DbObject; columns: ColumnInfo[] }[],
  priority: string[]
): { object: DbObject; columns: ColumnInfo[] }[] {
  if (priority.length === 0) return objects
  const rank = new Map(priority.map((name, i) => [name.toLowerCase(), i]))
  const head: { object: DbObject; columns: ColumnInfo[] }[] = []
  const tail: { object: DbObject; columns: ColumnInfo[] }[] = []
  for (const o of objects) (rank.has(o.object.name.toLowerCase()) ? head : tail).push(o)
  head.sort((a, b) => rank.get(a.object.name.toLowerCase())! - rank.get(b.object.name.toLowerCase())!)
  return [...head, ...tail]
}
