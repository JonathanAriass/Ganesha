import { describe, it, expect } from 'vitest'
import { toCsv, toJsonText, toJsonObjects } from './export'
import type { QueryResult, ColumnMeta } from '@shared/query'

const columns: ColumnMeta[] = [
  { name: 'id', dataType: null },
  { name: 'note', dataType: null }
]

describe('toCsv', () => {
  it('escapes quotes, commas and newlines; blanks nulls', () => {
    const csv = toCsv(columns, [
      [1, 'plain'],
      [2, 'a,b'],
      [3, 'say "hi"'],
      [4, null]
    ])
    expect(csv.split('\n').slice(0, 1)).toEqual(['id,note'])
    expect(csv).toContain('2,"a,b"')
    expect(csv).toContain('3,"say ""hi"""')
    expect(csv).toContain('4,')
  })
})

describe('toJsonObjects / toJsonText', () => {
  it('exports rows as column-keyed objects', () => {
    expect(JSON.parse(toJsonObjects(columns, [[1, 'x']]))).toEqual([{ id: 1, note: 'x' }])
  })

  it('toJsonText prefers documents when present, else falls back to row objects', () => {
    const base = { columns, rows: [[1, 'x']], rowCount: 1, durationMs: 0, truncated: false }
    const withDocs: QueryResult = { ...base, documents: [{ _id: 'a' }] }
    const withoutDocs: QueryResult = { ...base, documents: null }
    expect(JSON.parse(toJsonText(withDocs))).toEqual([{ _id: 'a' }])
    expect(JSON.parse(toJsonText(withoutDocs))).toEqual([{ id: 1, note: 'x' }])
  })
})
