import { describe, it, expect } from 'vitest'
import { tokenize, parseTerms, compileQuery, filterIndices, splitBoxColumns } from './result-filter'
import { parseColumnInput } from '../shared/query'
import type { FilterQuery } from '../shared/query'

const q = (text: string, over: Partial<FilterQuery> = {}): FilterQuery => ({
  text, caseSensitive: false, wholeWord: false, regex: false, columns: [], ...over,
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

describe('parseColumnInput', () => {
  it('parses leading operators, else contains', () => {
    expect(parseColumnInput('>30')).toEqual({ op: 'gt', value: '30' })
    expect(parseColumnInput('>=5')).toEqual({ op: 'ge', value: '5' })
    expect(parseColumnInput('<=10')).toEqual({ op: 'le', value: '10' })
    expect(parseColumnInput('<2')).toEqual({ op: 'lt', value: '2' })
    expect(parseColumnInput('=active')).toEqual({ op: 'eq', value: 'active' })
    expect(parseColumnInput('!=x')).toEqual({ op: 'ne', value: 'x' })
    expect(parseColumnInput('!foo')).toEqual({ op: 'ncontains', value: 'foo' })
    expect(parseColumnInput('foo')).toEqual({ op: 'contains', value: 'foo' })
  })
  it('is null for blank input', () => {
    expect(parseColumnInput('')).toBeNull()
    expect(parseColumnInput('   ')).toBeNull()
  })
})

describe('compileQuery — per-column constraints', () => {
  // row shape: [status(0), age(1)]
  const col = (column: number, op: string, value: string) => ({ column, op: op as never, value })
  const m = (over: Partial<FilterQuery>, row: unknown[]) => compileQuery(q('', over)).match(row)

  it('equals (numeric when both sides are numbers, else string)', () => {
    expect(m({ columns: [col(0, 'eq', 'active')] }, ['active', 25])).toBe(true)
    expect(m({ columns: [col(0, 'eq', 'active')] }, ['idle', 25])).toBe(false)
    expect(m({ columns: [col(1, 'eq', '25')] }, ['x', 25])).toBe(true) // numeric equality
  })
  it('numeric comparisons; non-numeric cells fail', () => {
    expect(m({ columns: [col(1, 'gt', '30')] }, ['x', 31])).toBe(true)
    expect(m({ columns: [col(1, 'gt', '30')] }, ['x', 20])).toBe(false)
    expect(m({ columns: [col(1, 'le', '25')] }, ['x', 25])).toBe(true)
    expect(m({ columns: [col(0, 'gt', '5')] }, ['active', 9])).toBe(false) // 'active' isn't numeric
  })
  it('contains / not-contains / not-equals', () => {
    expect(m({ columns: [col(0, 'contains', 'act')] }, ['active', 1])).toBe(true)
    expect(m({ columns: [col(0, 'ncontains', 'z')] }, ['active', 1])).toBe(true)
    expect(m({ columns: [col(0, 'ne', 'active')] }, ['active', 1])).toBe(false)
  })
  it('ANDs the global text with column constraints', () => {
    expect(m({ text: 'active', columns: [col(1, 'gt', '10')] }, ['active', 20])).toBe(true)
    expect(m({ text: 'active', columns: [col(1, 'gt', '10')] }, ['active', 5])).toBe(false) // age fails
    expect(m({ text: 'zzz', columns: [col(1, 'gt', '10')] }, ['active', 20])).toBe(false) // text fails
  })
})

describe('splitBoxColumns (box syntax)', () => {
  const names = ['status', 'age']
  it('pulls colname op value out, leaving the global text', () => {
    expect(splitBoxColumns('status=active foo age>30', names)).toEqual({
      globalText: 'foo',
      columns: [
        { column: 0, op: 'eq', value: 'active' },
        { column: 1, op: 'gt', value: '30' },
      ],
    })
  })
  it(': means contains; unknown columns stay global', () => {
    expect(splitBoxColumns('status:act other=x', names)).toEqual({
      globalText: 'other=x', // 'other' isn't a column
      columns: [{ column: 0, op: 'contains', value: 'act' }],
    })
  })
})

describe('compileQuery — box syntax resolves against column names', () => {
  const names = ['status', 'age']
  it('applies a box column term + combines with global terms', () => {
    expect(compileQuery(q('age>30'), names).match(['active', 40])).toBe(true)
    expect(compileQuery(q('age>30'), names).match(['active', 20])).toBe(false)
    expect(compileQuery(q('active age>10'), names).match(['active', 20])).toBe(true) // global + column
    expect(compileQuery(q('idle age>10'), names).match(['active', 20])).toBe(false) // global fails
  })
  it('ignores box syntax in regex mode (text is one pattern)', () => {
    // 'age>30' as a regex has no column meaning; it just tests each cell as a pattern.
    expect(compileQuery(q('age', { regex: true }), names).match(['age-column-note', 1])).toBe(true)
  })
})
