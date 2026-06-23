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

  const lines: string[] = []
  for (const { object, columns } of ordered) {
    const qualified = object.schema && object.schema !== 'public' ? `${object.schema}.${object.name}` : object.name
    const cols = columns.map((c) => `${c.name} ${c.dataType}${c.nullable ? '' : ' not null'}`).join(', ')
    lines.push(`${qualified}(${cols})`)
  }

  let body = ''
  let truncated = false
  for (const line of lines) {
    if (header.length + body.length + line.length + 1 > maxChars) { truncated = true; break }
    body += line + '\n'
  }
  const marker = truncated ? '… (schema truncated)\n' : ''
  return `${header}\nTables:\n${body}${marker}`.trimEnd()
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
