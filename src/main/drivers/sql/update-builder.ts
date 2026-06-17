import type { RowEdit } from '../../../shared/query'

export type SqlDialect = 'postgres' | 'mysql'

interface BuiltUpdate {
  sql: string
  params: unknown[]
}

function quoteIdent(dialect: SqlDialect, ident: string): string {
  if (dialect === 'postgres') return `"${ident.replace(/"/g, '""')}"`
  return `\`${ident.replace(/`/g, '``')}\``
}

function qualified(dialect: SqlDialect, table: { schema: string | null; name: string }): string {
  const name = quoteIdent(dialect, table.name)
  return table.schema ? `${quoteIdent(dialect, table.schema)}.${name}` : name
}

/** Build a single parameterized UPDATE for one row. Placeholders are $n (postgres) or
 *  ? (mysql); a null key value becomes `IS NULL` (no param); a null SET value is bound
 *  as a parameter. Throws when there are no SET columns or no key columns. */
export function buildUpdate(
  dialect: SqlDialect,
  table: { schema: string | null; name: string },
  edit: RowEdit
): BuiltUpdate {
  const setCols = Object.keys(edit.set)
  const keyCols = Object.keys(edit.key)
  if (setCols.length === 0) throw new Error('buildUpdate: no columns to set')
  if (keyCols.length === 0) throw new Error('buildUpdate: no key columns to match')

  const params: unknown[] = []
  const ph = (): string => (dialect === 'postgres' ? `$${params.length}` : '?')

  const setSql = setCols
    .map((c) => {
      params.push(edit.set[c])
      return `${quoteIdent(dialect, c)} = ${ph()}`
    })
    .join(', ')

  const whereSql = keyCols
    .map((c) => {
      const v = edit.key[c]
      if (v === null || v === undefined) return `${quoteIdent(dialect, c)} IS NULL`
      params.push(v)
      return `${quoteIdent(dialect, c)} = ${ph()}`
    })
    .join(' AND ')

  return { sql: `UPDATE ${qualified(dialect, table)} SET ${setSql} WHERE ${whereSql}`, params }
}
