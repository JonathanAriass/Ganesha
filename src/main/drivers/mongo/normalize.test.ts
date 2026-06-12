import { describe, it, expect } from 'vitest'
import { ObjectId, Long, Decimal128 } from 'bson'
import { normalizeFind, normalizeScalar, normalizeValues, normalizeWriteResult } from './normalize'

describe('mongo normalize', () => {
  it('normalizeFind builds a key-union table + EJSON documents, caps rows', () => {
    const oid = new ObjectId('507f1f77bcf86cd799439011')
    const docs = [{ _id: oid, name: 'a', age: 30 }, { _id: oid, name: 'b' }]
    const res = normalizeFind(docs, 10, 5)
    expect(res.columns.map((c) => c.name)).toEqual(['_id', 'name', 'age'])
    expect(res.rows[0][1]).toBe('a')
    expect(res.rows[1][2]).toBeNull()
    expect((res.rows[0][0] as { $oid: string }).$oid).toBe('507f1f77bcf86cd799439011')
    expect(res.rowCount).toBe(2)
    expect(res.truncated).toBe(false)
    expect(res.documents).toHaveLength(2)
    expect(res.durationMs).toBe(5)
  })

  it('normalizeFind truncates beyond maxRows and reports the shown count, not the probe size', () => {
    // The driver fetches at most maxRows+1 docs, so the input length is never the
    // true total — rowCount must say what is shown and truncated must say "more".
    const res = normalizeFind([{ a: 1 }, { a: 2 }, { a: 3 }], 2, 0)
    expect(res.rows).toHaveLength(2)
    expect(res.truncated).toBe(true)
    expect(res.rowCount).toBe(2)
  })

  it('normalizeValues keeps the exact total when truncating — distinct fetches the full array', () => {
    const res = normalizeValues('value', ['a', 'b', 'c'], 2, 0)
    expect(res.rows).toHaveLength(2)
    expect(res.truncated).toBe(true)
    expect(res.rowCount).toBe(3)
  })

  it('normalizeScalar wraps a count', () => {
    const res = normalizeScalar('count', 42, 1)
    expect(res.columns.map((c) => c.name)).toEqual(['count'])
    expect(res.rows).toEqual([[42]])
    expect(res.documents).toBeNull()
  })

  it('normalizeValues wraps distinct values', () => {
    const res = normalizeValues('value', ['us', 'uk'], 10, 1)
    expect(res.rows).toEqual([['us'], ['uk']])
  })

  it('normalizeWriteResult flattens an insert/update result', () => {
    const res = normalizeWriteResult({ acknowledged: true, insertedCount: 2 }, 1)
    expect(res.columns.map((c) => c.name)).toEqual(['acknowledged', 'insertedCount'])
    expect(res.rows).toEqual([[true, 2]])
    expect(res.documents).toBeNull()
  })

  it('Long stays a native number while safe, becomes an exact digit string beyond — the SQL drivers contract', () => {
    const res = normalizeFind(
      [{ small: Long.fromNumber(42), big: Long.fromString('9007199254740993'), nested: { deep: [Long.fromString('-9007199254740993')] } }],
      10, 0
    )
    // relaxed EJSON alone would have read big as …992
    expect(res.rows[0]).toEqual([42, '9007199254740993', { deep: ['-9007199254740993'] }])
    // rows and the documents tree share one serialization — the tree heals too
    expect((res.documents as Record<string, unknown>[])[0].big).toBe('9007199254740993')
  })

  it('Long boundary: 2^53−1 is the last native number; 2^53 itself goes string', () => {
    const res = normalizeFind([{ a: Long.fromString('9007199254740991'), b: Long.fromString('9007199254740992') }], 10, 0)
    expect(res.rows[0]).toEqual([9007199254740991, '9007199254740992'])
  })

  it('unsigned Long max round-trips exactly through normalizeValues', () => {
    const res = normalizeValues('v', [Long.fromString('18446744073709551615', true)], 10, 0)
    expect(res.rows).toEqual([['18446744073709551615']])
  })

  it('Date, ObjectId and Decimal128 still take the EJSON path untouched by the Long walk', () => {
    const res = normalizeFind([{ d: new Date(0), o: new ObjectId('507f1f77bcf86cd799439011'), m: Decimal128.fromString('0.1') }], 10, 0)
    expect((res.rows[0][0] as { $date: string }).$date).toContain('1970-01-01')
    expect((res.rows[0][1] as { $oid: string }).$oid).toBe('507f1f77bcf86cd799439011')
    expect(res.rows[0][2]).toEqual({ $numberDecimal: '0.1' })
  })
})
