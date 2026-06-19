import { describe, it, expect } from 'vitest'
import {
  clampColumnWidth,
  buildGridTemplate,
  gridMinWidth,
  autoFitWidth,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
  DEFAULT_COL_WIDTH,
} from './column-size'

describe('clampColumnWidth', () => {
  it('clamps to the min and max and rounds', () => {
    expect(clampColumnWidth(10)).toBe(MIN_COL_WIDTH)
    expect(clampColumnWidth(9999)).toBe(MAX_COL_WIDTH)
    expect(clampColumnWidth(200.6)).toBe(201)
  })
})

describe('buildGridTemplate', () => {
  it('uses px for resized columns and the fill default for untouched ones', () => {
    expect(buildGridTemplate(3, { 1: 220 })).toBe(
      `minmax(${DEFAULT_COL_WIDTH}px, 1fr) 220px minmax(${DEFAULT_COL_WIDTH}px, 1fr)`,
    )
  })
  it('all untouched → all fill', () => {
    expect(buildGridTemplate(2, {})).toBe(
      `minmax(${DEFAULT_COL_WIDTH}px, 1fr) minmax(${DEFAULT_COL_WIDTH}px, 1fr)`,
    )
  })
})

describe('gridMinWidth', () => {
  it('sums resized px and the default for untouched columns', () => {
    expect(gridMinWidth(3, { 1: 300 })).toBe(DEFAULT_COL_WIDTH + 300 + DEFAULT_COL_WIDTH)
  })
})

describe('autoFitWidth', () => {
  const measure = (s: string): number => s.length * 7 // fake monospace metric

  it('picks the widest of header and cells, adds padding, clamps', () => {
    // widest cell is 20 chars → 140px + 24 padding = 164
    expect(autoFitWidth('id', ['short', 'a much longer value!'], measure, 24)).toBe(164)
  })
  it('header can be the widest', () => {
    expect(autoFitWidth('a_very_wide_header_name', ['x'], measure, 24)).toBe(23 * 7 + 24)
  })
  it('clamps a giant value to the max', () => {
    expect(autoFitWidth('h', ['x'.repeat(500)], measure)).toBe(MAX_COL_WIDTH)
  })
})
