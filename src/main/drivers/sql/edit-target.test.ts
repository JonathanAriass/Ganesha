import { describe, it, expect } from 'vitest'
import { buildEditableResult, isSingleTableScan, type PerColumnSource } from './edit-target'

const T = { schema: 'public', name: 'users' }
const cols = (...c: (string | null)[]): PerColumnSource[] =>
  c.map((column) => (column === null ? { table: null, column: null } : { table: T, column }))

describe('buildEditableResult', () => {
  it('builds a descriptor for a single-table result with its PK present', () => {
    expect(buildEditableResult(cols('id', 'name', 'email'), ['id'])).toEqual({
      table: T,
      keyColumns: ['id'],
      columnSources: ['id', 'name', 'email']
    })
  })
  it('marks expression columns (null source) as non-editable but stays editable overall', () => {
    expect(buildEditableResult([...cols('id', 'name'), { table: null, column: null }], ['id'])).toEqual({
      table: T,
      keyColumns: ['id'],
      columnSources: ['id', 'name', null]
    })
  })
  it('returns null when more than one source table is present', () => {
    const mixed: PerColumnSource[] = [
      { table: T, column: 'id' },
      { table: { schema: 'public', name: 'orders' }, column: 'id' }
    ]
    expect(buildEditableResult(mixed, ['id'])).toBeNull()
  })
  it('returns null when there is no source table at all', () => {
    expect(buildEditableResult([{ table: null, column: null }], ['id'])).toBeNull()
  })
  it('returns null when the table has no primary key', () => {
    expect(buildEditableResult(cols('id', 'name'), [])).toBeNull()
  })
  it('returns null when a PK column is absent from the result', () => {
    expect(buildEditableResult(cols('name', 'email'), ['id'])).toBeNull()
  })
  it('returns null when a source column is projected twice (self-join ambiguity)', () => {
    // SELECT a.id, b.id FROM t a, t b — both columns resolve to the same base column.
    const dup: PerColumnSource[] = [
      { table: T, column: 'id' },
      { table: T, column: 'id' }
    ]
    expect(buildEditableResult(dup, ['id'])).toBeNull()
  })

  it('supports a composite primary key', () => {
    expect(buildEditableResult(cols('a', 'b', 'v'), ['a', 'b'])).toEqual({
      table: T,
      keyColumns: ['a', 'b'],
      columnSources: ['a', 'b', 'v']
    })
  })
})

describe('isSingleTableScan', () => {
  it('is true for a plain single-table select', () => {
    expect(isSingleTableScan('SELECT * FROM users WHERE id = 1', 'users')).toBe(true)
    expect(isSingleTableScan('select id, name from users u', 'users')).toBe(true)
  })
  it('is false for a self-join, even with disjoint columns or comma form', () => {
    expect(isSingleTableScan('SELECT a.id, b.val FROM t a JOIN t b ON b.parent = a.id', 't')).toBe(false)
    expect(isSingleTableScan('SELECT * FROM t a, t b', 't')).toBe(false)
  })
  it('is false for ANY CTE (a CTE can be self-joined on its alias, invisible to a name count)', () => {
    expect(isSingleTableScan('WITH c AS (SELECT * FROM t) SELECT a.id, b.val FROM c a JOIN c b ON b.parent = a.id', 't')).toBe(false)
    expect(isSingleTableScan('WITH recent AS (SELECT * FROM t) SELECT * FROM recent', 't')).toBe(false) // over-refuses, safely
    expect(isSingleTableScan('  with x as (select 1) select * from t', 't')).toBe(false)
  })
  it('is false for a CTE introduced after any lead token (semicolon, paren) or with extras', () => {
    expect(isSingleTableScan(';WITH c AS (SELECT * FROM t) SELECT a.id, b.val FROM c a JOIN c b ON true', 't')).toBe(false) // leading ;
    expect(isSingleTableScan('WITH c (a, b) AS (SELECT id, val FROM t) SELECT x.a, y.b FROM c x JOIN c y ON true', 't')).toBe(false) // column list
    expect(isSingleTableScan('WITH RECURSIVE c AS (SELECT * FROM t) SELECT * FROM c x JOIN c y ON true', 't')).toBe(false) // recursive
  })
  it('does not treat non-CTE WITH usages (WITH ROLLUP) as a CTE', () => {
    // WITH ROLLUP lacks the `<name> AS (` shape, so the CTE guard must not fire; the
    // single-scan count of `t` is 1, so isSingleTableScan returns true.
    expect(isSingleTableScan('SELECT id, count(*) FROM t GROUP BY id WITH ROLLUP', 't')).toBe(true)
  })
  it('is false for a derived-table self-join (reference hidden in a subquery)', () => {
    expect(isSingleTableScan('SELECT x.id, y.val FROM (SELECT * FROM t WHERE id > 0) x JOIN t y ON y.id = x.parent', 't')).toBe(false)
  })
  it('is false for a parenthesis-wrapped CTE (anchor bypass)', () => {
    expect(isSingleTableScan('(WITH c AS (SELECT * FROM t) SELECT a.id, b.val FROM c a JOIN c b ON true)', 't')).toBe(false)
    expect(isSingleTableScan('( WITH c AS (SELECT * FROM t) SELECT * FROM c a, c b )', 't')).toBe(false)
    expect(isSingleTableScan('((WITH c AS (SELECT * FROM t) SELECT * FROM c))', 't')).toBe(false)
  })
  it('stays true for a parenthesized plain single-table select', () => {
    expect(isSingleTableScan('(SELECT id, val FROM t)', 't')).toBe(true)
  })
  it('stays true for a subquery over a DIFFERENT table', () => {
    expect(isSingleTableScan('SELECT * FROM t WHERE id IN (SELECT tid FROM other)', 't')).toBe(true)
  })
  it('handles a schema qualifier and quoting', () => {
    expect(isSingleTableScan('SELECT * FROM public.users', 'users')).toBe(true)
    expect(isSingleTableScan('SELECT * FROM "users" a JOIN "users" b', 'users')).toBe(false)
  })
  it('ignores the name inside string literals and comments', () => {
    expect(isSingleTableScan("SELECT * FROM t WHERE note = 'from t'", 't')).toBe(true)
    expect(isSingleTableScan('SELECT * FROM t -- join t\n', 't')).toBe(true)
  })
  it('does not match a longer table name sharing a prefix', () => {
    expect(isSingleTableScan('SELECT * FROM t2 JOIN t ON true', 't')).toBe(true)
  })
})
