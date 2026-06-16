import { describe, it, expect } from 'vitest'
import type { DbObject } from '@shared/schema'
import { substringMatch, objectMatches, filterObjects } from './object-filter'

describe('substringMatch', () => {
  it('matches a contiguous run at the start and returns its positions', () => {
    expect(substringMatch('user', 'users')).toEqual([0, 1, 2, 3])
  })
  it('matches a contiguous run in the middle', () => {
    expect(substringMatch('set', '43_settings')).toEqual([3, 4, 5])
  })
  it('is case-insensitive but returns indices into the original target', () => {
    expect(substringMatch('US', 'users')).toEqual([0, 1])
  })
  it('returns null for a gapped (non-contiguous) match', () => {
    expect(substringMatch('usr', 'users')).toBeNull() // u·s·r is not a substring
    expect(substringMatch('oes', 'orders')).toBeNull()
  })
  it('returns null when not present at all', () => {
    expect(substringMatch('xyz', 'users')).toBeNull()
  })
  it('returns null when the query is longer than the target', () => {
    expect(substringMatch('userss', 'users')).toBeNull()
  })
  it('returns [] for an empty query (matches everything, no highlight)', () => {
    expect(substringMatch('', 'users')).toEqual([])
  })
  it('returns code-point indices, not UTF-16 units, so highlights align past an astral char', () => {
    // '😀' is one code point but two UTF-16 units; positions must stay code-point based
    // to line up with the component's [...name] rendering.
    expect(substringMatch('tbl', '😀tbl_users')).toEqual([1, 2, 3])
    expect(substringMatch('😀a', '😀abc')).toEqual([0, 1])
  })
  it('stays aligned when a char lowercases to a different length (İ → i̇)', () => {
    expect(substringMatch('tab', 'İ_table')).toEqual([2, 3, 4])
  })
})

const OBJECTS: DbObject[] = [
  { schema: 'public', name: 'users', kind: 'table' },
  { schema: 'public', name: 'orders', kind: 'table' },
  { schema: 'sales', name: 'invoices', kind: 'table' }
]

describe('objectMatches', () => {
  it('matches on a contiguous run in the object name', () => {
    expect(objectMatches(OBJECTS[0], 'ser')).toBe(true) // 'users' contains 'ser'
  })
  it('does not match a gapped query', () => {
    expect(objectMatches(OBJECTS[0], 'usr')).toBe(false)
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
    // 'r' is a substring of users and orders, but not invoices.
    expect(filterObjects(OBJECTS, 'r').map((o) => o.name)).toEqual(['users', 'orders'])
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
