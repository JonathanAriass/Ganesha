import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { parseMongoShell } from './shell'

describe('parseMongoShell', () => {
  it('parses find with filter, projection, and chained modifiers', () => {
    const cmd = parseMongoShell('db.users.find({ age: { $gt: 21 } }, { name: 1 }).sort({ name: 1 }).limit(50).skip(10)')
    expect(cmd).toEqual({
      op: 'find', collection: 'users',
      filter: { age: { $gt: 21 } }, projection: { name: 1 }, sort: { name: 1 }, limit: 50, skip: 10
    })
  })

  it('parses aggregate, countDocuments, distinct', () => {
    expect(parseMongoShell('db.orders.aggregate([{ $match: { x: 1 } }])').pipeline).toEqual([{ $match: { x: 1 } }])
    expect(parseMongoShell('db.c.countDocuments({ a: 1 })').filter).toEqual({ a: 1 })
    const d = parseMongoShell('db.c.distinct("country", { active: true })')
    expect(d.field).toBe('country')
    expect(d.filter).toEqual({ active: true })
  })

  it('parses writes (insertOne / updateOne / deleteMany) and BSON helper args', () => {
    expect(parseMongoShell('db.c.insertOne({ a: 1 })').document).toEqual({ a: 1 })
    const upd = parseMongoShell('db.c.updateOne({ a: 1 }, { $set: { a: 2 } })')
    expect(upd.update).toEqual({ $set: { a: 2 } })
    const f = parseMongoShell('db.c.find({ _id: ObjectId("507f1f77bcf86cd799439011") })')
    expect((f.filter!._id as ObjectId).toHexString()).toBe('507f1f77bcf86cd799439011')
  })

  it('rejects unknown ops, non-shell input, and unsupported chained methods', () => {
    expect(() => parseMongoShell('db.c.dropDatabase()')).toThrow(/unsupported operation/i)
    expect(() => parseMongoShell('1 + 1')).toThrow(/mongo shell command/i)
    expect(() => parseMongoShell('db.c.find().bogus()')).toThrow(/unsupported chained method/i)
    expect(() => parseMongoShell('not valid (')).toThrow(/could not parse/i)
  })

  describe('getSiblingDB', () => {
    it('targets another database, with modifiers and bracket collections', () => {
      const cmd = parseMongoShell('db.getSiblingDB("other").users.find({ a: 1 }).sort({ a: 1 }).limit(5)')
      expect(cmd).toEqual({
        op: 'find', collection: 'users', database: 'other',
        filter: { a: 1 }, sort: { a: 1 }, limit: 5
      })
      expect(parseMongoShell('db.getSiblingDB("x")["my coll"].countDocuments({})')).toEqual({
        op: 'countDocuments', collection: 'my coll', database: 'x', filter: {}
      })
    })

    it('plain db commands carry no database field', () => {
      expect(parseMongoShell('db.users.find({})')).not.toHaveProperty('database')
    })

    it('rejects bad arguments and a missing collection', () => {
      expect(() => parseMongoShell('db.getSiblingDB(5).c.find({})')).toThrow(/must be a non-empty string/i)
      expect(() => parseMongoShell('db.getSiblingDB("a", "b").c.find({})')).toThrow(/exactly one string argument/i)
      expect(() => parseMongoShell('db.getSiblingDB("a").find({})')).toThrow(/expected a collection after getSiblingDB/i)
      expect(() => parseMongoShell('db.getSiblingDB("a").c.dropDatabase()')).toThrow(/unsupported operation/i)
    })
  })
})
