import { describe, it, expect } from 'vitest'
import { parseMongoJson } from './raw'

describe('parseMongoJson', () => {
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

  it('rejects invalid JSON, unknown op, missing collection, and bad field types', () => {
    expect(() => parseMongoJson('{not json')).toThrow(/invalid json/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'nope', collection: 'c' }))).toThrow(/op/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: '' }))).toThrow(/collection/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', limit: 'x' }))).toThrow(/limit/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'aggregate', collection: 'c' }))).toThrow(/pipeline/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'insertOne', collection: 'c' }))).toThrow(/document/i)
  })
})
