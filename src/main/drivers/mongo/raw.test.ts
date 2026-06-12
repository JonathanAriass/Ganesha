import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { parseMongoJson } from './raw'

describe('parseMongoJson', () => {
  it('deserializes EJSON type wrappers to BSON (e.g. {$oid} -> ObjectId)', () => {
    const cmd = parseMongoJson('{ "op": "find", "collection": "c", "filter": { "_id": { "$oid": "507f1f77bcf86cd799439011" } } }')
    expect(cmd.filter!._id).toBeInstanceOf(ObjectId)
    expect((cmd.filter!._id as ObjectId).toHexString()).toBe('507f1f77bcf86cd799439011')
  })

  it('$numberLong survives parsing exactly as a Long — relaxed mode would collapse it to a lossy double', () => {
    const cmd = parseMongoJson('{"op":"insertOne","collection":"c","document":{"n":{"$numberLong":"9007199254740993"}}}')
    const n = cmd.document!.n as { _bsontype: string; toString(): string }
    expect(n._bsontype).toBe('Long')
    expect(n.toString()).toBe('9007199254740993')
  })

  it('plain numbers, $numberInt and $numberDouble still come out as plain JS numbers', () => {
    const cmd = parseMongoJson(JSON.stringify({
      op: 'find', collection: 'c', limit: 5,
      filter: { a: 30, b: 3.5, c: { $numberInt: '7' }, d: { $numberDouble: '2.5' } }
    }))
    expect(cmd.limit).toBe(5) // envelope validation saw a plain number, not an Int32 instance
    expect(cmd.filter).toEqual({ a: 30, b: 3.5, c: 7, d: 2.5 }) // deep-equal fails on instances
  })

  it('$date survives the number unwrap as a real Date (no _bsontype to shield it)', () => {
    const cmd = parseMongoJson('{"op":"find","collection":"c","filter":{"t":{"$date":"2026-06-12T00:00:00Z"}}}')
    expect(cmd.filter!.t).toBeInstanceOf(Date)
    expect((cmd.filter!.t as Date).toISOString()).toBe('2026-06-12T00:00:00.000Z')
  })

  it('parses a find with filter/projection/sort/limit/skip', () => {
    const cmd = parseMongoJson(JSON.stringify({
      op: 'find', collection: 'users',
      filter: { age: { $gt: 21 } }, projection: { name: 1 }, sort: { name: 1 }, limit: 50, skip: 10
    }))
    expect(cmd).toEqual({
      op: 'find', collection: 'users',
      filter: { age: { $gt: 21 } }, projection: { name: 1 }, sort: { name: 1 }, limit: 50, skip: 10
    })
  })

  it('parses aggregate with a pipeline', () => {
    const cmd = parseMongoJson(JSON.stringify({ op: 'aggregate', collection: 'orders', pipeline: [{ $match: { x: 1 } }] }))
    expect(cmd.op).toBe('aggregate')
    expect(cmd.pipeline).toEqual([{ $match: { x: 1 } }])
  })

  it('parses distinct / insertOne / updateOne / deleteMany', () => {
    expect(parseMongoJson(JSON.stringify({ op: 'distinct', collection: 'c', field: 'country' })).field).toBe('country')
    expect(parseMongoJson(JSON.stringify({ op: 'insertOne', collection: 'c', document: { a: 1 } })).document).toEqual({ a: 1 })
    const upd = parseMongoJson(JSON.stringify({ op: 'updateOne', collection: 'c', filter: { a: 1 }, update: { $set: { a: 2 } } }))
    expect(upd.update).toEqual({ $set: { a: 2 } })
    expect(parseMongoJson(JSON.stringify({ op: 'deleteMany', collection: 'c', filter: { a: 1 } })).filter).toEqual({ a: 1 })
  })

  it('passes an optional database through, rejecting empty/non-string values', () => {
    expect(parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', database: 'other' })).database).toBe('other')
    expect(parseMongoJson(JSON.stringify({ op: 'find', collection: 'c' }))).not.toHaveProperty('database')
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', database: '' }))).toThrow(/database/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', database: 5 }))).toThrow(/database/i)
  })

  it('rejects invalid JSON, unknown op, missing collection, and bad field types', () => {
    expect(() => parseMongoJson('{not json')).toThrow(/invalid json/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'nope', collection: 'c' }))).toThrow(/op/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: '' }))).toThrow(/collection/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', limit: 'x' }))).toThrow(/limit/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', limit: -1 }))).toThrow(/non-negative/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', skip: 1.5 }))).toThrow(/non-negative/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'aggregate', collection: 'c' }))).toThrow(/pipeline/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'insertOne', collection: 'c' }))).toThrow(/document/i)
  })
})
