import { describe, it, expect } from 'vitest'
import { appendCapped } from './ssm-output'

describe('appendCapped', () => {
  it('appends unchanged while under the cap', () => {
    expect(appendCapped('abc', 'def', 10)).toBe('abcdef')
    expect(appendCapped('', 'x', 10)).toBe('x')
  })
  it('keeps exactly the cap', () => {
    expect(appendCapped('abcde', 'fghij', 10)).toBe('abcdefghij')
  })
  it('over the cap keeps the tail', () => {
    expect(appendCapped('abcdefgh', 'ijkl', 10)).toBe('cdefghijkl')
  })
  it('a single chunk larger than the cap keeps its own tail', () => {
    expect(appendCapped('abc', '0123456789XYZ', 10)).toBe('3456789XYZ')
  })
})
