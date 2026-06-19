import { describe, it, expect } from 'vitest'
import { rowCountLabel, truncationLabel, affectedRowsLabel } from './result-label'

const rows = (n: number): unknown[][] => Array.from({ length: n }, () => [])

describe('result labels', () => {
  it('not truncated: exact count, no chip', () => {
    const r = { rows: rows(42), rowCount: 42, truncated: false }
    expect(rowCountLabel(r)).toBe('42 rows')
    expect(truncationLabel(r)).toBeNull()
  })

  it('truncated with a known total (SQL drivers fetch everything): "of" chip', () => {
    const r = { rows: rows(1000), rowCount: 45231, truncated: true }
    expect(rowCountLabel(r)).toBe('45231 rows')
    expect(truncationLabel(r)).toBe('showing first 1000 of 45231')
  })

  it('truncated with an unknown total (mongo bounded fetch): "+" and "(more available)"', () => {
    const r = { rows: rows(1000), rowCount: 1000, truncated: true }
    expect(rowCountLabel(r)).toBe('1000+ rows')
    expect(truncationLabel(r)).toBe('showing first 1000 (more available)')
  })

  it('write results (rowCount = affected, no rows) stay exact', () => {
    expect(rowCountLabel({ rows: [[true, 2]], rowCount: 2, truncated: false })).toBe('2 rows')
  })

  it('singular for one row', () => {
    expect(rowCountLabel({ rows: rows(1), rowCount: 1, truncated: false })).toBe('1 row')
  })
})

describe('affectedRowsLabel (write/command results — no result set)', () => {
  it('pluralizes the affected count', () => {
    expect(affectedRowsLabel({ rowCount: 5 })).toBe('5 rows affected')
  })
  it('singular for one affected row', () => {
    expect(affectedRowsLabel({ rowCount: 1 })).toBe('1 row affected')
  })
  it('zero matches reads as 0 rows affected (an UPDATE that hit nothing)', () => {
    expect(affectedRowsLabel({ rowCount: 0 })).toBe('0 rows affected')
  })
})
