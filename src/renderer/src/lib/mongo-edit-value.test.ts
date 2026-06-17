import { describe, it, expect } from 'vitest'
import { coerceMongoEditValue } from './mongo-edit-value'

describe('coerceMongoEditValue', () => {
  it('keeps a string-typed field a string (no accidental number coercion)', () => {
    expect(coerceMongoEditValue('42', 'old')).toBe('42')
  })
  it('parses a number-typed field back to a number', () => {
    expect(coerceMongoEditValue('43', 7)).toBe(43)
  })
  it('parses a boolean-typed field', () => {
    expect(coerceMongoEditValue('false', true)).toBe(false)
  })
  it('parses an object/array (the editor shows JSON) back to a value', () => {
    expect(coerceMongoEditValue('{"a":1}', { a: 0 })).toEqual({ a: 1 })
  })
  it('falls back to the raw string when a non-string field gets unparseable text', () => {
    expect(coerceMongoEditValue('hello', 5)).toBe('hello')
  })
  it('passes null through (the NULL control)', () => {
    expect(coerceMongoEditValue(null, 5)).toBeNull()
  })
})
