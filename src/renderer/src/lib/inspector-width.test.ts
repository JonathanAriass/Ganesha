import { describe, it, expect } from 'vitest'
import { clampWidth, dragWidth, loadWidth, saveWidth, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH } from './inspector-width'

function fakeStorage(initial?: string) {
  let value: string | null = initial ?? null
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v
    },
    get value() {
      return value
    },
  }
}

describe('clampWidth', () => {
  it('passes mid-range through, clamps the extremes', () => {
    expect(clampWidth(500)).toBe(500)
    expect(clampWidth(10)).toBe(MIN_WIDTH)
    expect(clampWidth(99999)).toBe(MAX_WIDTH)
  })
  it('heals non-finite garbage to the default; rounds sub-pixel', () => {
    expect(clampWidth(NaN)).toBe(DEFAULT_WIDTH)
    expect(clampWidth(Infinity)).toBe(DEFAULT_WIDTH)
    expect(clampWidth(340.7)).toBe(341)
  })
})

describe('dragWidth (right-docked)', () => {
  it('width is the panel right edge minus the pointer x', () => {
    expect(dragWidth(600, 1000)).toBe(400)
  })
  it('clamps drags past either bound', () => {
    expect(dragWidth(995, 1000)).toBe(MIN_WIDTH)
    expect(dragWidth(-5000, 1000)).toBe(MAX_WIDTH)
  })
})

describe('load/save', () => {
  it('defaults when unset; round-trips a saved value', () => {
    expect(loadWidth(fakeStorage())).toBe(DEFAULT_WIDTH)
    const s = fakeStorage()
    saveWidth(500, s)
    expect(s.value).toBe('500')
    expect(loadWidth(s)).toBe(500)
  })
  it('clamps a garbage stored value on load', () => {
    expect(loadWidth(fakeStorage('99999'))).toBe(MAX_WIDTH)
    expect(loadWidth(fakeStorage('nope'))).toBe(DEFAULT_WIDTH)
  })
})
