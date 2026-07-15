import { describe, it, expect } from 'vitest'
import { asJsonTree } from './json-field'

describe('asJsonTree', () => {
  it('treats an object/array value as a tree (not from a string)', () => {
    const obj = { a: 1, b: { c: 2 } }
    expect(asJsonTree(obj)).toEqual({ tree: obj, wasString: false })
    const arr = [1, 2, 3]
    expect(asJsonTree(arr)).toEqual({ tree: arr, wasString: false })
    expect(asJsonTree({})).toEqual({ tree: {}, wasString: false })
  })

  it('parses a JSON-object/array string and flags wasString', () => {
    expect(asJsonTree('{"a":1}')).toEqual({ tree: { a: 1 }, wasString: true })
    expect(asJsonTree('  [1,2] ')).toEqual({ tree: [1, 2], wasString: true })
  })

  it('returns null for scalars and plain strings', () => {
    expect(asJsonTree('42')).toBeNull() // a scalar string, not an object/array
    expect(asJsonTree('hello')).toBeNull()
    expect(asJsonTree('true')).toBeNull()
    expect(asJsonTree(42)).toBeNull()
    expect(asJsonTree(true)).toBeNull()
    expect(asJsonTree(null)).toBeNull()
    expect(asJsonTree(undefined)).toBeNull()
  })

  it('returns null for malformed JSON that merely looks like an object', () => {
    expect(asJsonTree('{ not json')).toBeNull()
    expect(asJsonTree('[1,2')).toBeNull()
  })
})
