import { describe, it, expect } from 'vitest'
import type { DbObject } from '@shared/schema'
import { fuzzyMatch, objectMatches, filterObjects } from './object-filter'

describe('fuzzyMatch', () => {
  it('matches an exact substring and returns its positions', () => {
    expect(fuzzyMatch('user', 'users')).toEqual([0, 1, 2, 3])
  })
  it('matches a gapped subsequence (chars in order, not adjacent)', () => {
    expect(fuzzyMatch('usr', 'users')).toEqual([0, 1, 3]) // u, s, (e skipped), r
  })
  it('is case-insensitive but returns indices into the original target', () => {
    expect(fuzzyMatch('US', 'users')).toEqual([0, 1])
  })
  it('returns null when not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'users')).toBeNull()
    expect(fuzzyMatch('sru', 'users')).toBeNull() // wrong order
  })
  it('returns null when the query is longer than the target', () => {
    expect(fuzzyMatch('userss', 'users')).toBeNull()
  })
  it('returns [] for an empty query (matches everything, no highlight)', () => {
    expect(fuzzyMatch('', 'users')).toEqual([])
  })
})

const OBJECTS: DbObject[] = [
  { schema: 'public', name: 'users', kind: 'table' },
  { schema: 'public', name: 'orders', kind: 'table' },
  { schema: 'sales', name: 'invoices', kind: 'table' }
]

describe('objectMatches', () => {
  it('matches on the object name', () => {
    expect(objectMatches(OBJECTS[0], 'usr')).toBe(true)
  })
  it('matches on the schema name (surfaces the whole schema)', () => {
    expect(objectMatches(OBJECTS[2], 'sales')).toBe(true)
  })
  it('is true for an empty query', () => {
    expect(objectMatches(OBJECTS[1], '')).toBe(true)
  })
  it('is false when neither name nor schema matches', () => {
    expect(objectMatches(OBJECTS[1], 'xyz')).toBe(false)
  })
})

describe('filterObjects', () => {
  it('keeps matches in original order', () => {
    // 'es' is a subsequence of users, orders, AND invoices.
    expect(filterObjects(OBJECTS, 'es').map((o) => o.name)).toEqual(['users', 'orders', 'invoices'])
  })
  it('returns all objects for an empty query', () => {
    expect(filterObjects(OBJECTS, '')).toEqual(OBJECTS)
  })
  it('narrows by object name', () => {
    expect(filterObjects(OBJECTS, 'inv').map((o) => o.name)).toEqual(['invoices'])
  })
  it('includes every object of a schema matched by name', () => {
    expect(filterObjects(OBJECTS, 'public').map((o) => o.name)).toEqual(['users', 'orders'])
  })
})
