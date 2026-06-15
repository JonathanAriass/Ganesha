import { describe, it, expect } from 'vitest'
import { buildSchemaContext } from './schema-context'
import type { DbObject, ColumnInfo } from '../../shared/schema'

const t = (name: string, cols: ColumnInfo[]): { object: DbObject; columns: ColumnInfo[] } => ({
  object: { schema: 'public', name, kind: 'table' }, columns: cols
})
const col = (name: string, dataType: string, nullable = true): ColumnInfo => ({ name, dataType, nullable })

describe('buildSchemaContext', () => {
  it('emits a dialect line and a compact table summary', () => {
    const out = buildSchemaContext('postgres', [t('users', [col('id', 'int8', false), col('email', 'text')])])
    expect(out).toMatch(/postgres/i)
    expect(out).toContain('users')
    expect(out).toContain('id')
    expect(out).toContain('int8')
    expect(out).toContain('email')
  })

  it('marks not-null columns and qualifies non-public schemas', () => {
    const out = buildSchemaContext('postgres', [
      { object: { schema: 'app', name: 'orders', kind: 'table' }, columns: [col('total', 'numeric', false)] }
    ])
    expect(out).toContain('app.orders')
    expect(out).toMatch(/total[^\n]*not null/i)
  })

  it('truncates to the char budget with a marker rather than dumping everything', () => {
    const many = Array.from({ length: 200 }, (_, i) => t(`tbl${i}`, [col('c', 'int')]))
    const out = buildSchemaContext('mysql', many, 500)
    expect(out.length).toBeLessThanOrEqual(600) // budget + the marker line
    expect(out).toMatch(/truncated/i)
  })

  it('handles an empty schema without throwing', () => {
    expect(buildSchemaContext('postgres', [])).toMatch(/no tables/i)
  })
})
