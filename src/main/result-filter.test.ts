import { describe, it, expect } from 'vitest'
import { cellMatchesFilter, rowMatchesFilter, filterIndices } from './result-filter'

describe('cellMatchesFilter', () => {
  it('matches case-insensitively as a substring', () => {
    expect(cellMatchesFilter('Hello World', 'hello')).toBe(true)
    expect(cellMatchesFilter('Hello World', 'WOR')).toBe(true)
    expect(cellMatchesFilter('Hello', 'xyz')).toBe(false)
  })
  it('stringifies numbers, bigints, and objects', () => {
    expect(cellMatchesFilter(42, '4')).toBe(true)
    expect(cellMatchesFilter(9007199254740993n, '740993')).toBe(true)
    expect(cellMatchesFilter({ city: 'Oviedo' }, 'oviedo')).toBe(true)
    expect(cellMatchesFilter([1, 2, 3], '2')).toBe(true)
  })
  it('treats null/undefined as empty and an empty needle as match-all', () => {
    expect(cellMatchesFilter(null, 'x')).toBe(false)
    expect(cellMatchesFilter(undefined, 'x')).toBe(false)
    expect(cellMatchesFilter(null, '')).toBe(true)
  })
})

describe('rowMatchesFilter', () => {
  it('matches when any cell contains the needle', () => {
    expect(rowMatchesFilter(['a', 'b', 'c'], 'b')).toBe(true)
    expect(rowMatchesFilter(['a', 'b', 'c'], 'z')).toBe(false)
  })
  it('empty needle matches every row', () => {
    expect(rowMatchesFilter([null, null], '')).toBe(true)
  })
})

describe('filterIndices', () => {
  it('returns the original indexes of matching rows', () => {
    const rows = [['apple'], ['banana'], ['apricot'], ['cherry']]
    expect(filterIndices(rows, 'ap')).toEqual([0, 2]) // apple, apricot
  })
  it('empty needle returns all indexes in order', () => {
    expect(filterIndices([['a'], ['b'], ['c']], '')).toEqual([0, 1, 2])
  })
  it('no match returns empty', () => {
    expect(filterIndices([['a'], ['b']], 'z')).toEqual([])
  })
})
