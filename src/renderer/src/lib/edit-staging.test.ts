import { describe, it, expect } from 'vitest'
import type { EditableResult } from '@shared/query'
import { dirtyKey, buildRowEdits, describeEdits } from './edit-staging'
import type { ColumnMeta } from '@shared/query'

const editable: EditableResult = {
  table: { schema: 'public', name: 'users' },
  keyColumns: ['id'],
  columnSources: ['id', 'name', 'email'] // result columns 0,1,2
}
const rows = [
  [1, 'a', 'a@x.io'],
  [2, 'b', 'b@x.io']
]

describe('dirtyKey', () => {
  it('keys by row id and column index', () => {
    expect(dirtyKey(0, 2)).toBe('0:2')
  })
})

describe('buildRowEdits', () => {
  it('groups dirty cells per row, reading key values from the row', () => {
    const dirty = {
      [dirtyKey(0, 1)]: 'AA',
      [dirtyKey(0, 2)]: 'aa@x.io',
      [dirtyKey(1, 1)]: 'BB'
    }
    expect(buildRowEdits(dirty, rows, editable)).toEqual([
      { key: { id: 1 }, set: { name: 'AA', email: 'aa@x.io' } },
      { key: { id: 2 }, set: { name: 'BB' } }
    ])
  })
  it('ignores dirty entries on non-editable (null-source) columns', () => {
    const e2: EditableResult = { ...editable, columnSources: ['id', 'name', null] }
    expect(buildRowEdits({ [dirtyKey(0, 2)]: 'x' }, rows, e2)).toEqual([])
  })
  it('ignores a dirty key column (PK is read-only)', () => {
    expect(buildRowEdits({ [dirtyKey(0, 0)]: 99 }, rows, editable)).toEqual([])
  })
  it('reads a composite key from the row', () => {
    const e3: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['a', 'b'], columnSources: ['a', 'b', 'v'] }
    expect(buildRowEdits({ [dirtyKey(0, 2)]: 9 }, [[10, 20, 30]], e3)).toEqual([{ key: { a: 10, b: 20 }, set: { v: 9 } }])
  })
})

describe('describeEdits', () => {
  const cols: ColumnMeta[] = [
    { name: 'id', dataType: 'int' },
    { name: 'name', dataType: 'text' },
    { name: 'email', dataType: 'text' }
  ]
  it('describes each staged cell with table, key, column, old and new values, ordered by row then column', () => {
    const dirty = { [dirtyKey(1, 2)]: 'bb@x.io', [dirtyKey(0, 2)]: 'aa@x.io', [dirtyKey(0, 1)]: 'AA' }
    expect(describeEdits(dirty, cols, rows, editable)).toEqual([
      { table: 'public.users', key: { id: 1 }, column: 'email', oldValue: 'a@x.io', newValue: 'aa@x.io' }, // row 0
      { table: 'public.users', key: { id: 1 }, column: 'name', oldValue: 'a', newValue: 'AA' }, // row 0
      { table: 'public.users', key: { id: 2 }, column: 'email', oldValue: 'b@x.io', newValue: 'bb@x.io' } // row 1
    ])
  })
  it('omits the schema prefix when there is none', () => {
    const e: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', 'name', 'email'] }
    expect(describeEdits({ [dirtyKey(0, 1)]: 'X' }, cols, rows, e)[0].table).toBe('t')
  })
})
