import { describe, it, expect } from 'vitest'
import { overflowEnds, scrollStep } from './scroll-hints'

describe('overflowEnds', () => {
  it('reports nothing when everything fits', () => {
    expect(overflowEnds({ pos: 0, size: 800, client: 800 })).toEqual({ start: false, end: false })
  })
  it('reports the end that has content out of view', () => {
    expect(overflowEnds({ pos: 0, size: 2000, client: 800 })).toEqual({ start: false, end: true })
    expect(overflowEnds({ pos: 600, size: 2000, client: 800 })).toEqual({ start: true, end: true })
    expect(overflowEnds({ pos: 1200, size: 2000, client: 800 })).toEqual({ start: true, end: false })
  })
  it('ignores sub-pixel remainders at either end', () => {
    expect(overflowEnds({ pos: 0.6, size: 2000, client: 800 })).toEqual({ start: false, end: true })
    expect(overflowEnds({ pos: 1199.4, size: 2000, client: 800 })).toEqual({ start: true, end: false })
  })
})

describe('scrollStep', () => {
  it('jumps most of the visible extent, never less than a row or a tab', () => {
    expect(scrollStep(1000)).toBe(800)
    expect(scrollStep(100)).toBe(120)
  })
})
