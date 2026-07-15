import { describe, it, expect } from 'vitest'
import { tokenize, parseTerms, compileQuery, filterIndices } from './result-filter'
import type { FilterQuery } from '../shared/query'

const q = (text: string, over: Partial<FilterQuery> = {}): FilterQuery => ({
  text, caseSensitive: false, wholeWord: false, regex: false, ...over,
})
const hit = (fq: FilterQuery, row: unknown[]): boolean => compileQuery(fq).match(row)

describe('tokenize', () => {
  it('keeps quoted spans and leading -/! attached', () => {
    expect(tokenize('foo -"a b" OR !bar')).toEqual(['foo', '-"a b"', 'OR', '!bar'])
  })
})

describe('parseTerms', () => {
  it('separates positives/negatives and detects OR', () => {
    expect(parseTerms('foo -bar')).toEqual({ positives: ['foo'], negatives: ['bar'], op: 'and' })
    expect(parseTerms('a OR b')).toEqual({ positives: ['a', 'b'], negatives: [], op: 'or' })
    expect(parseTerms('"x y" !z')).toEqual({ positives: ['x y'], negatives: ['z'], op: 'and' })
  })
})

describe('compileQuery — substring + case', () => {
  it('is a case-insensitive substring by default', () => {
    expect(hit(q('LO'), ['hello'])).toBe(true)
    expect(hit(q('xyz'), ['hello'])).toBe(false)
  })
  it('respects the case-sensitive toggle', () => {
    expect(hit(q('LO', { caseSensitive: true }), ['hello'])).toBe(false)
    expect(hit(q('lo', { caseSensitive: true }), ['hello'])).toBe(true)
  })
  it('empty text matches everything', () => {
    expect(hit(q('   '), ['whatever'])).toBe(true)
  })
})

describe('compileQuery — AND / OR / negation (any cell)', () => {
  it('AND: every positive term must match some cell', () => {
    expect(hit(q('a b'), ['a x', 'b y'])).toBe(true) // a in cell0, b in cell1
    expect(hit(q('a z'), ['a', 'b'])).toBe(false) // z absent
  })
  it('OR: any positive term matching is enough', () => {
    expect(hit(q('z OR a'), ['a'])).toBe(true)
    expect(hit(q('z OR w'), ['a'])).toBe(false)
  })
  it('negation excludes rows containing the term', () => {
    expect(hit(q('-secret'), ['public'])).toBe(true)
    expect(hit(q('-secret'), ['secret data'])).toBe(false)
    expect(hit(q('a -b'), ['a', 'c'])).toBe(true)
    expect(hit(q('a -b'), ['a', 'b'])).toBe(false)
  })
})

describe('compileQuery — whole word', () => {
  it('matches only at word boundaries', () => {
    expect(hit(q('cat', { wholeWord: true }), ['category'])).toBe(false)
    expect(hit(q('cat', { wholeWord: true }), ['a cat sat'])).toBe(true)
  })
})

describe('compileQuery — regex', () => {
  it('tests the whole text as a regex per cell', () => {
    expect(hit(q('^h.*o$', { regex: true }), ['hello'])).toBe(true)
    expect(hit(q('\\d+', { regex: true }), [42])).toBe(true) // stringified
    expect(hit(q('^x', { regex: true }), ['hello'])).toBe(false)
  })
  it('flags an invalid regex and matches nothing', () => {
    const c = compileQuery(q('[', { regex: true }))
    expect(c.invalid).toBe(true)
    expect(c.match(['anything'])).toBe(false)
  })
})

describe('compileQuery — quoted phrase', () => {
  it('matches the phrase literally (spaces kept)', () => {
    expect(hit(q('"a b"'), ['x a b y'])).toBe(true)
    expect(hit(q('"a b"'), ['ab'])).toBe(false)
  })
})

describe('filterIndices', () => {
  it('returns original indexes of matching rows', () => {
    const rows = [['alpha'], ['banana'], ['alto']]
    expect(filterIndices(rows, q('al'))).toEqual([0, 2])
  })
  it('empty query returns all', () => {
    expect(filterIndices([['a'], ['b']], q(''))).toEqual([0, 1])
  })
})
