import { describe, it, expect } from 'vitest'
import { jsonStringify } from './json'

describe('jsonStringify', () => {
  it('matches JSON.stringify for plain values, compact and pretty', () => {
    const v = { a: 1, b: ['x', null], c: { d: true } }
    expect(jsonStringify(v)).toBe(JSON.stringify(v))
    expect(jsonStringify(v, true)).toBe(JSON.stringify(v, null, 2))
  })

  it('renders BigInt as exact digit strings instead of throwing', () => {
    expect(() => JSON.stringify({ n: 1n })).toThrow() // the failure mode being prevented
    expect(jsonStringify({ n: 9007199254740993n })).toBe('{"n":"9007199254740993"}')
    expect(jsonStringify([1n, 2])).toBe('["1",2]')
  })

  it('handles a top-level BigInt (root passes through the replacer too)', () => {
    expect(jsonStringify(123n)).toBe('"123"')
  })
})
