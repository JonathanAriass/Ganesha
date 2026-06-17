import { describe, it, expect } from 'vitest'
import { buildEditableResult, sourceTableReferenceCount, type PerColumnSource } from './edit-target'

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

describe('sourceTableReferenceCount', () => {
  it('counts one for a plain single-table select', () => {
    expect(sourceTableReferenceCount('SELECT * FROM users WHERE id = 1', 'users')).toBe(1)
    expect(sourceTableReferenceCount('select id, name from users u', 'users')).toBe(1)
  })
  it('counts two for a self-join, even with disjoint columns', () => {
    expect(sourceTableReferenceCount('SELECT a.id, b.val FROM t a JOIN t b ON b.parent = a.id', 't')).toBe(2)
    expect(sourceTableReferenceCount('SELECT * FROM t a, t b', 't')).toBe(2)
  })
  it('handles a schema qualifier and quoting', () => {
    expect(sourceTableReferenceCount('SELECT * FROM public.users', 'users')).toBe(1)
    expect(sourceTableReferenceCount('SELECT * FROM "users" a JOIN "users" b', 'users')).toBe(2)
  })
  it('ignores the name inside string literals and comments', () => {
    expect(sourceTableReferenceCount("SELECT * FROM t WHERE note = 'from t'", 't')).toBe(1)
    expect(sourceTableReferenceCount('SELECT * FROM t -- join t\n', 't')).toBe(1)
  })
  it('does not match a longer table name sharing a prefix', () => {
    expect(sourceTableReferenceCount('SELECT * FROM t2 JOIN t ON true', 't')).toBe(1)
  })
})
