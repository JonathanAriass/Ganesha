import { describe, it, expect } from 'vitest'
import { buildEditableResult, type PerColumnSource } from './edit-target'

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
