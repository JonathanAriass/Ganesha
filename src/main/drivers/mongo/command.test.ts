import { describe, it, expect } from 'vitest'
import { isMongoOp, isMongoReadOp, assertMongoWritable, isMongoCommandWrite, assertMongoCommandWritable } from './command'
import type { MongoCommand } from './command'

describe('mongo command model', () => {
  it('recognizes known ops and rejects unknown', () => {
    expect(isMongoOp('find')).toBe(true)
    expect(isMongoOp('updateMany')).toBe(true)
    expect(isMongoOp('dropDatabase')).toBe(false)
    expect(isMongoOp('')).toBe(false)
  })

  it('classifies read vs write ops', () => {
    expect(isMongoReadOp('aggregate')).toBe(true)
    expect(isMongoReadOp('deleteOne')).toBe(false)
  })

  it('assertMongoWritable allows reads always, blocks writes only when read-only', () => {
    expect(() => assertMongoWritable('find', true)).not.toThrow()
    expect(() => assertMongoWritable('insertOne', false)).not.toThrow()
    expect(() => assertMongoWritable('insertOne', true)).toThrow(/read-only/i)
  })
})

describe('mongo command-level write detection', () => {
  const find: MongoCommand = { op: 'find', collection: 'c' }
  const del: MongoCommand = { op: 'deleteOne', collection: 'c', filter: {} }
  const aggRead: MongoCommand = { op: 'aggregate', collection: 'c', pipeline: [{ $match: { x: 1 } }] }
  const aggOut: MongoCommand = { op: 'aggregate', collection: 'c', pipeline: [{ $match: { x: 1 } }, { $out: 'dest' }] }
  const aggMerge: MongoCommand = { op: 'aggregate', collection: 'c', pipeline: [{ $merge: { into: 'dest' } }] }

  it('classifies reads vs writes incl. aggregate $out/$merge', () => {
    expect(isMongoCommandWrite(find)).toBe(false)
    expect(isMongoCommandWrite(del)).toBe(true)
    expect(isMongoCommandWrite(aggRead)).toBe(false)
    expect(isMongoCommandWrite(aggOut)).toBe(true)
    expect(isMongoCommandWrite(aggMerge)).toBe(true)
  })

  it('assertMongoCommandWritable blocks writes (incl. $out/$merge aggregate) only when read-only', () => {
    expect(() => assertMongoCommandWritable(aggRead, true)).not.toThrow()
    expect(() => assertMongoCommandWritable(aggOut, false)).not.toThrow()
    expect(() => assertMongoCommandWritable(aggOut, true)).toThrow(/read-only/i)
    expect(() => assertMongoCommandWritable(del, true)).toThrow(/read-only/i)
  })
})
