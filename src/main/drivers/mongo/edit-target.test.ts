import { describe, it, expect } from 'vitest'
import type { ColumnMeta } from '../../../shared/query'
import { mongoEditable } from './edit-target'

const cols = (...names: string[]): ColumnMeta[] => names.map((name) => ({ name, dataType: null }))
const T = { schema: 'shop', name: 'users' }

describe('mongoEditable', () => {
  it('is editable when _id is present; every top-level field maps to itself, _id is the key', () => {
    expect(mongoEditable(cols('_id', 'name', 'age'), T)).toEqual({
      table: T,
      keyColumns: ['_id'],
      columnSources: ['_id', 'name', 'age']
    })
  })
  it('is null when _id is absent (e.g. projected away — can not target the document)', () => {
    expect(mongoEditable(cols('name', 'age'), T)).toBeNull()
  })
  it('is null for an empty column set', () => {
    expect(mongoEditable(cols(), T)).toBeNull()
  })
})
