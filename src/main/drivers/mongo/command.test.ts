import { describe, it, expect } from 'vitest'
import { isMongoOp, isMongoReadOp, assertMongoWritable } from './command'

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
