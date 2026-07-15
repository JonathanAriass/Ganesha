import { describe, it, expect } from 'vitest'
import { highlightSegments } from './highlight'

const opt = (over = {}) => ({ regex: false, caseSensitive: false, wholeWord: false, ...over })

describe('highlightSegments', () => {
  it('splits around a case-insensitive substring hit', () => {
    expect(highlightSegments('Hello World', ['world'], opt())).toEqual([
      { text: 'Hello ', hit: false },
      { text: 'World', hit: true },
    ])
  })

  it('highlights every occurrence of multiple terms', () => {
    expect(highlightSegments('a b a', ['a'], opt())).toEqual([
      { text: 'a', hit: true },
      { text: ' b ', hit: false },
      { text: 'a', hit: true },
    ])
    const segs = highlightSegments('cat dog', ['cat', 'dog'], opt())
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['cat', 'dog'])
  })

  it('respects case-sensitive and whole-word', () => {
    expect(highlightSegments('Cat cat', ['cat'], opt({ caseSensitive: true }))).toEqual([
      { text: 'Cat ', hit: false },
      { text: 'cat', hit: true },
    ])
    // whole-word: 'cat' does not hit inside 'category'
    expect(highlightSegments('category', ['cat'], opt({ wholeWord: true }))).toEqual([
      { text: 'category', hit: false },
    ])
  })

  it('regex mode uses the first term as a pattern', () => {
    expect(highlightSegments('id=42', ['\\d+'], opt({ regex: true }))).toEqual([
      { text: 'id=', hit: false },
      { text: '42', hit: true },
    ])
  })

  it('no terms / no match / invalid regex → one plain segment', () => {
    expect(highlightSegments('abc', [], opt())).toEqual([{ text: 'abc', hit: false }])
    expect(highlightSegments('abc', ['z'], opt())).toEqual([{ text: 'abc', hit: false }])
    expect(highlightSegments('abc', ['['], opt({ regex: true }))).toEqual([{ text: 'abc', hit: false }])
  })

  it('does not loop on a zero-width pattern', () => {
    expect(highlightSegments('abc', ['x*'], opt({ regex: true }))).toEqual([{ text: 'abc', hit: false }])
  })
})
