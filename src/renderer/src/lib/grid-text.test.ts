import { describe, it, expect } from 'vitest'
import { cellText, rowMatchesFilter } from './grid-text'

describe('cellText', () => {
  it('blanks null/undefined, stringifies objects, passes scalars through', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
    expect(cellText({ a: 1 })).toBe('{"a":1}')
    expect(cellText(42)).toBe('42')
    expect(cellText('x')).toBe('x')
  })
})

describe('rowMatchesFilter', () => {
  const row = ['Alice', 42, { city: 'Oviedo' }, null]

  it('matches case-insensitively against any cell', () => {
    expect(rowMatchesFilter(row, 'alice')).toBe(true)
    expect(rowMatchesFilter(row, '42')).toBe(true)
    expect(rowMatchesFilter(row, 'bob')).toBe(false)
  })

  it('matches inside stringified object cells — same projection the grid renders', () => {
    expect(rowMatchesFilter(row, 'oviedo')).toBe(true)
  })

  it('passes every row for the empty filter', () => {
    expect(rowMatchesFilter(row, '')).toBe(true)
  })
})
