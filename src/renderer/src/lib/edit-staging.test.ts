import { describe, it, expect } from 'vitest'
import type { EditableResult, ColumnMeta } from '@shared/query'
import { editKey, buildRowEdits, describeEdits } from './edit-staging'

const editable: EditableResult = {
  table: { schema: 'public', name: 'users' },
  keyColumns: ['id'],
  columnSources: ['id', 'name', 'email'] // result columns 0,1,2 (paths are the field names)
}
const rows = [
  [1, 'a', 'a@x.io'],
  [2, 'b', 'b@x.io']
]

describe('buildRowEdits', () => {
  it('groups dirty cells per row, set keyed by field path, reading the key from the row', () => {
    const dirty = {
      [editKey(0, 'name')]: 'AA',
      [editKey(0, 'email')]: 'aa@x.io',
      [editKey(1, 'name')]: 'BB'
    }
    expect(buildRowEdits(dirty, rows, editable)).toEqual([
      { key: { id: 1 }, set: { name: 'AA', email: 'aa@x.io' } },
      { key: { id: 2 }, set: { name: 'BB' } }
    ])
  })
  it('keeps a nested dotted path as the set key (Mongo)', () => {
    const e: EditableResult = { table: { schema: 'db', name: 'c' }, keyColumns: ['_id'], columnSources: ['_id', 'addr'] }
    const dirty = { [editKey(0, 'addr.city')]: 'Lyon', [editKey(0, 'tags.0')]: 'z' }
    expect(buildRowEdits(dirty, [[7, {}]], e)).toEqual([{ key: { _id: 7 }, set: { 'addr.city': 'Lyon', 'tags.0': 'z' } }])
  })
  it('ignores a dirty key column', () => {
    expect(buildRowEdits({ [editKey(0, 'id')]: 99 }, rows, editable)).toEqual([])
  })
  it('reads a composite key from the row', () => {
    const e3: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['a', 'b'], columnSources: ['a', 'b', 'v'] }
    expect(buildRowEdits({ [editKey(0, 'v')]: 9 }, [[10, 20, 30]], e3)).toEqual([{ key: { a: 10, b: 20 }, set: { v: 9 } }])
  })
})

describe('describeEdits', () => {
  const cols: ColumnMeta[] = [
    { name: 'id', dataType: 'int' },
    { name: 'name', dataType: 'text' },
    { name: 'email', dataType: 'text' }
  ]
  it('describes each edit by path, row key, old (from row) and new value, ordered by row then path', () => {
    const dirty = { [editKey(1, 'email')]: 'bb@x.io', [editKey(0, 'email')]: 'aa@x.io', [editKey(0, 'name')]: 'AA' }
    expect(describeEdits(dirty, cols, rows, null, editable)).toEqual([
      { table: 'public.users', key: { id: 1 }, column: 'email', oldValue: 'a@x.io', newValue: 'aa@x.io' },
      { table: 'public.users', key: { id: 1 }, column: 'name', oldValue: 'a', newValue: 'AA' },
      { table: 'public.users', key: { id: 2 }, column: 'email', oldValue: 'b@x.io', newValue: 'bb@x.io' }
    ])
  })
  it('reads a nested old value from the documents array (Mongo)', () => {
    const e: EditableResult = { table: { schema: 'db', name: 'c' }, keyColumns: ['_id'], columnSources: ['_id', 'addr'] }
    const mcols: ColumnMeta[] = [{ name: '_id', dataType: null }, { name: 'addr', dataType: null }]
    const mrows = [[7, { city: 'Paris' }]]
    const docs = [{ _id: 7, addr: { city: 'Paris' } }]
    const got = describeEdits({ [editKey(0, 'addr.city')]: 'Lyon' }, mcols, mrows, docs, e)
    expect(got).toEqual([{ table: 'db.c', key: { _id: 7 }, column: 'addr.city', oldValue: 'Paris', newValue: 'Lyon' }])
  })
  it('omits the schema prefix when there is none', () => {
    const e: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', 'name', 'email'] }
    expect(describeEdits({ [editKey(0, 'name')]: 'X' }, cols, rows, null, e)[0].table).toBe('t')
  })
})
