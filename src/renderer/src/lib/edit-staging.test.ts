import { describe, it, expect } from 'vitest'
import type { EditableResult } from '@shared/query'
import { dirtyKey, buildRowEdits } from './edit-staging'

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
    const dirty = new Map<string, unknown>([
      [dirtyKey(0, 1), 'AA'],
      [dirtyKey(0, 2), 'aa@x.io'],
      [dirtyKey(1, 1), 'BB']
    ])
    expect(buildRowEdits(dirty, rows, editable)).toEqual([
      { key: { id: 1 }, set: { name: 'AA', email: 'aa@x.io' } },
      { key: { id: 2 }, set: { name: 'BB' } }
    ])
  })
  it('ignores dirty entries on non-editable (null-source) columns', () => {
    const e2: EditableResult = { ...editable, columnSources: ['id', 'name', null] }
    const dirty = new Map<string, unknown>([[dirtyKey(0, 2), 'x']])
    expect(buildRowEdits(dirty, rows, e2)).toEqual([])
  })
  it('ignores a dirty key column (PK is read-only)', () => {
    const dirty = new Map<string, unknown>([[dirtyKey(0, 0), 99]])
    expect(buildRowEdits(dirty, rows, editable)).toEqual([])
  })
  it('reads a composite key from the row', () => {
    const e3: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['a', 'b'], columnSources: ['a', 'b', 'v'] }
    const dirty = new Map<string, unknown>([[dirtyKey(0, 2), 9]])
    expect(buildRowEdits(dirty, [[10, 20, 30]], e3)).toEqual([{ key: { a: 10, b: 20 }, set: { v: 9 } }])
  })
})
