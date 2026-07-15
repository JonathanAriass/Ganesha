import { describe, it, expect } from 'vitest'
import { ResultCache } from './query-cache'

const rows = (n: number): unknown[][] => Array.from({ length: n }, (_, i) => [i])

describe('ResultCache', () => {
  it('pages a stored result and reports hasMore at the boundary', () => {
    const c = new ResultCache()
    c.store('q', { rows: rows(2500), documents: null })

    const p1 = c.page('q', 0, 1000)!
    expect(p1.rows).toHaveLength(1000)
    expect(p1.rows[0]).toEqual([0])
    expect(p1.hasMore).toBe(true)

    const p3 = c.page('q', 2000, 1000)!
    expect(p3.rows).toHaveLength(500) // 2000..2500
    expect(p3.rows[0]).toEqual([2000])
    expect(p3.hasMore).toBe(false) // 2500 rows, end = 3000
  })

  it('slices documents in lockstep with rows', () => {
    const c = new ResultCache()
    c.store('q', { rows: rows(3), documents: [{ a: 0 }, { a: 1 }, { a: 2 }] })
    const p = c.page('q', 1, 1)!
    expect(p.rows).toEqual([[1]])
    expect(p.documents).toEqual([{ a: 1 }])
    expect(p.hasMore).toBe(true)
  })

  it('returns null for an unknown / released id', () => {
    const c = new ResultCache()
    c.store('q', { rows: rows(10), documents: null })
    expect(c.page('nope', 0, 5)).toBeNull()
    c.release('q')
    expect(c.page('q', 0, 5)).toBeNull()
  })

  it('evicts the least-recently-used beyond the cap', () => {
    const c = new ResultCache(2)
    c.store('a', { rows: rows(1), documents: null })
    c.store('b', { rows: rows(1), documents: null })
    c.store('c', { rows: rows(1), documents: null }) // evicts 'a'
    expect(c.page('a', 0, 1)).toBeNull()
    expect(c.page('b', 0, 1)).not.toBeNull()
    expect(c.size()).toBe(2)
  })

  it('page() bumps recency so a fresh insert evicts a different entry', () => {
    const c = new ResultCache(2)
    c.store('a', { rows: rows(1), documents: null })
    c.store('b', { rows: rows(1), documents: null })
    c.page('a', 0, 1) // 'a' becomes MRU, 'b' now oldest
    c.store('c', { rows: rows(1), documents: null }) // evicts 'b', not 'a'
    expect(c.page('a', 0, 1)).not.toBeNull()
    expect(c.page('b', 0, 1)).toBeNull()
  })

  it('an offset at/after the end yields an empty page with hasMore false', () => {
    const c = new ResultCache()
    c.store('q', { rows: rows(10), documents: null })
    const p = c.page('q', 10, 1000)!
    expect(p.rows).toEqual([])
    expect(p.hasMore).toBe(false)
  })
})

describe('ResultCache.filterPage', () => {
  const q = (text: string, over = {}) => ({ text, caseSensitive: false, wholeWord: false, regex: false, ...over })
  const c = new ResultCache()
  // 5 rows; 'al' matches rows 0 (alpha) and 2 (alto) only.
  c.store('q', {
    rows: [['alpha'], ['banana'], ['alto'], ['cherry'], ['delta']],
    documents: [{ n: 'alpha' }, { n: 'banana' }, { n: 'alto' }, { n: 'cherry' }, { n: 'delta' }],
  })

  it('returns matching rows with their ORIGINAL indexes + total', () => {
    const p = c.filterPage('q', q('al'), 0, 10)!
    expect(p.rows).toEqual([['alpha'], ['alto']])
    expect(p.indices).toEqual([0, 2]) // original result indexes, for stable edit keys
    expect(p.documents).toEqual([{ n: 'alpha' }, { n: 'alto' }])
    expect(p.total).toBe(2)
    expect(p.hasMore).toBe(false)
    expect(p.invalid).toBe(false)
  })

  it('pages the matches and reports hasMore at the boundary', () => {
    const p1 = c.filterPage('q', q(''), 0, 2)! // empty filter matches all 5
    expect(p1.rows).toHaveLength(2)
    expect(p1.indices).toEqual([0, 1])
    expect(p1.total).toBe(5)
    expect(p1.hasMore).toBe(true)
    const p2 = c.filterPage('q', q(''), 4, 2)!
    expect(p2.indices).toEqual([4])
    expect(p2.hasMore).toBe(false)
  })

  it('applies operators (negation) through the query', () => {
    const p = c.filterPage('q', q('-al'), 0, 10)! // rows WITHOUT 'al' → banana, cherry, delta
    expect(p.indices).toEqual([1, 3, 4])
  })

  it('flags an invalid regex query', () => {
    const p = c.filterPage('q', q('[', { regex: true }), 0, 10)!
    expect(p.invalid).toBe(true)
    expect(p.total).toBe(0)
    expect(p.rows).toEqual([])
  })

  it('no matches → empty page, total 0', () => {
    const p = c.filterPage('q', q('zzz'), 0, 10)!
    expect(p.rows).toEqual([])
    expect(p.total).toBe(0)
    expect(p.hasMore).toBe(false)
  })

  it('returns null on a cache miss', () => {
    expect(c.filterPage('nope', q('a'), 0, 10)).toBeNull()
  })
})
