import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
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

  it('normalizeFind truncates beyond maxRows', () => {
    const res = normalizeFind([{ a: 1 }, { a: 2 }, { a: 3 }], 2, 0)
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
})
