import { describe, it, expect } from 'vitest'
import { editKey, parseEditKey, getAtPath, setAtPath, isEjsonWrapper } from './doc-path'

describe('editKey', () => {
  it('round-trips row index and path (path may contain dots/colons/spaces)', () => {
    expect(parseEditKey(editKey(3, 'a.b:c d'))).toEqual({ rowIndex: 3, path: 'a.b:c d' })
  })
})

describe('getAtPath / setAtPath', () => {
  it('reads a nested value and an array element', () => {
    expect(getAtPath({ a: { b: 1 }, t: [10, 20] }, 'a.b')).toBe(1)
    expect(getAtPath({ t: [10, 20] }, 't.1')).toBe(20)
  })
  it('returns undefined through a missing branch', () => {
    expect(getAtPath({ a: null }, 'a.b')).toBeUndefined()
    expect(getAtPath({}, 'x.y')).toBeUndefined()
  })
  it('sets immutably, sharing untouched branches', () => {
    const root = { a: { b: 1, c: 2 }, x: 9 }
    const next = setAtPath(root, 'a.b', 5)
    expect(next).toEqual({ a: { b: 5, c: 2 }, x: 9 })
    expect(next).not.toBe(root)
    expect(next.x).toBe(root.x) // untouched branch shared
  })
  it('sets an array element immutably', () => {
    const root = { t: [10, 20, 30] }
    const next = setAtPath(root, 't.1', 99)
    expect(next).toEqual({ t: [10, 99, 30] })
    expect(Array.isArray(next.t)).toBe(true)
  })
  it('sets a top-level field', () => {
    expect(setAtPath({ a: 1 }, 'a', 2)).toEqual({ a: 2 })
  })
})

describe('isEjsonWrapper', () => {
  it('is true for single $-prefixed-key wrappers', () => {
    expect(isEjsonWrapper({ $oid: 'x' })).toBe(true)
    expect(isEjsonWrapper({ $date: 'x' })).toBe(true)
    expect(isEjsonWrapper({ $numberLong: '1' })).toBe(true)
  })
  it('is false for plain objects, multi-key, arrays, scalars, null', () => {
    expect(isEjsonWrapper({ a: 1 })).toBe(false)
    expect(isEjsonWrapper({ $oid: 'x', y: 1 })).toBe(false)
    expect(isEjsonWrapper([1])).toBe(false)
    expect(isEjsonWrapper('s')).toBe(false)
    expect(isEjsonWrapper(5)).toBe(false)
    expect(isEjsonWrapper(null)).toBe(false)
  })
})
