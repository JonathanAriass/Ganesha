import { describe, it, expect } from 'vitest'
import { inferFieldTypes } from './infer'

describe('inferFieldTypes', () => {
  it('returns [] for null', () => {
    expect(inferFieldTypes(null)).toEqual([])
  })

  it('maps known BSON/JS types from a sample doc', () => {
    const objectId = { _bsontype: 'ObjectId' }
    const dateVal = new Date('2024-01-01')
    const doc = {
      _id: objectId,
      name: 'Alice',
      age: 30,
      tags: ['a', 'b'],
      meta: { key: 'value' },
      createdAt: dateVal,
      active: true,
      deletedAt: null
    }
    const result = inferFieldTypes(doc as Record<string, unknown>)
    expect(result).toEqual([
      { name: '_id', dataType: 'objectId', nullable: true },
      { name: 'name', dataType: 'string', nullable: true },
      { name: 'age', dataType: 'number', nullable: true },
      { name: 'tags', dataType: 'array', nullable: true },
      { name: 'meta', dataType: 'object', nullable: true },
      { name: 'createdAt', dataType: 'date', nullable: true },
      { name: 'active', dataType: 'boolean', nullable: true },
      { name: 'deletedAt', dataType: 'null', nullable: true }
    ])
  })
})
