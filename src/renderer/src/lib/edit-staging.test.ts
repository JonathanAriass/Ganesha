import { describe, it, expect } from 'vitest'
import type { EditableResult, ColumnMeta } from '@shared/query'
import { editKey, buildRowEdits, describeEdits, columnEditable, columnEditKey, editChangesValue } from './edit-staging'

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

describe('columnEditable', () => {
  it('is true for a non-key table column on a writable editable result', () => {
    expect(columnEditable(editable, false, 1)).toBe(true) // name
    expect(columnEditable(editable, false, 2)).toBe(true) // email
  })
  it('is false for a key column, a read-only connection, or a non-editable result', () => {
    expect(columnEditable(editable, false, 0)).toBe(false) // id is the key
    expect(columnEditable(editable, true, 1)).toBe(false) // read-only
    expect(columnEditable(null, false, 1)).toBe(false) // result not single-table
  })
  it('is false for a column with no table source (expression/join)', () => {
    const e: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', null] }
    expect(columnEditable(e, false, 1)).toBe(false)
  })
})

describe('columnEditKey', () => {
  it('keys an editable column by row + field path', () => {
    expect(columnEditKey(editable, 3, 1)).toBe(editKey(3, 'name'))
  })
  it('is null for a column with no source or a non-editable result', () => {
    const e: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', null] }
    expect(columnEditKey(e, 0, 1)).toBeNull()
    expect(columnEditKey(null, 0, 1)).toBeNull()
  })
})

describe('editChangesValue', () => {
  it('is false when the committed text equals the original (a no-op open + Enter)', () => {
    expect(editChangesValue('965', 965)).toBe(false) // number shown as "965", retyped/unchanged
    expect(editChangesValue('hello', 'hello')).toBe(false)
    expect(editChangesValue('{"a":1}', { a: 1 })).toBe(false) // object seeded as its JSON text
  })
  it('treats a NULL field (seeded empty) committed empty as unchanged', () => {
    expect(editChangesValue('', null)).toBe(false) // the real bug: NULL renders '', Enter ≠ a change
    expect(editChangesValue('', undefined)).toBe(false)
  })
  it('is true for a real change', () => {
    expect(editChangesValue('966', 965)).toBe(true)
    expect(editChangesValue('', 965)).toBe(true) // cleared a value to empty string
    expect(editChangesValue('x', null)).toBe(true) // typed into a NULL field
  })
  it('handles the ∅ NULL button (null editor output)', () => {
    expect(editChangesValue(null, null)).toBe(false) // NULL → NULL
    expect(editChangesValue(null, 965)).toBe(true) // set a value to NULL
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
