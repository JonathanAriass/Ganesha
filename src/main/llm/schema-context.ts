import type { DbObject, ColumnInfo } from '../../shared/schema'

const DEFAULT_BUDGET = 6000

/** Render the connection schema as a compact, dialect-tagged summary for the
 *  system prompt. Truncates to a char budget so a huge schema can't blow the
 *  model's context window. */
export function buildSchemaContext(
  dialect: string,
  objects: { object: DbObject; columns: ColumnInfo[] }[],
  maxChars = DEFAULT_BUDGET
): string {
  const header = `Database dialect: ${dialect}.`
  if (objects.length === 0) return `${header}\n(no tables found)`

  const lines: string[] = []
  for (const { object, columns } of objects) {
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
