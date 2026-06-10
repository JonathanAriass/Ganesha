import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { parseMongoQuery } from './parse'

describe('parseMongoQuery (auto-detect)', () => {
  it('routes db.* input to the shell parser', () => {
    const cmd = parseMongoQuery('  db.users.find({ age: { $gt: 21 } }).limit(5)  ')
    expect(cmd.op).toBe('find')
    expect(cmd.collection).toBe('users')
    expect(cmd.limit).toBe(5)
  })

  it('routes JSON input to the raw parser (and deserializes EJSON to BSON)', () => {
    const cmd = parseMongoQuery('{ "op": "find", "collection": "c", "filter": { "_id": { "$oid": "507f1f77bcf86cd799439011" } } }')
    expect(cmd.op).toBe('find')
    expect((cmd.filter!._id as ObjectId).toHexString?.()).toBe('507f1f77bcf86cd799439011')
  })
})
