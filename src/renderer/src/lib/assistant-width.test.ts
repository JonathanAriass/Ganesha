import { describe, it, expect } from 'vitest'
import {
  clampWidth, dragWidth, loadWidth, saveWidth,
  DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH
} from './assistant-width'

function fakeStorage(initial?: string) {
  let value: string | null = initial ?? null
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => { value = v },
    get value() { return value }
  }
}

describe('clampWidth', () => {
  it('passes mid-range through, clamps the extremes', () => {
    expect(clampWidth(500)).toBe(500)
    expect(clampWidth(10)).toBe(MIN_WIDTH)
    expect(clampWidth(99999)).toBe(MAX_WIDTH)
  })
  it('heals non-finite garbage to the default', () => {
    expect(clampWidth(NaN)).toBe(DEFAULT_WIDTH)
    expect(clampWidth(Infinity)).toBe(DEFAULT_WIDTH)
  })
  it('rounds sub-pixel widths to a whole pixel', () => {
    expect(clampWidth(420.7)).toBe(421)
    expect(clampWidth(500.2)).toBe(500)
  })
})

describe('dragWidth', () => {
  it('width is the panel right edge minus the pointer x (panel is docked right)', () => {
    // right edge at 1000, pointer at 600 → 400px wide
    expect(dragWidth(600, 1000)).toBe(400)
  })
  it('clamps drags past either bound', () => {
    expect(dragWidth(990, 1000)).toBe(MIN_WIDTH) // dragged almost to the right edge
    expect(dragWidth(-5000, 1000)).toBe(MAX_WIDTH) // dragged way left
  })
})

describe('load/saveWidth', () => {
  it('defaults when nothing stored', () => {
    expect(loadWidth(fakeStorage())).toBe(DEFAULT_WIDTH)
  })
  it('round-trips and clamps on load + save', () => {
    const s = fakeStorage()
    saveWidth(520, s)
    expect(loadWidth(s)).toBe(520)
    expect(loadWidth(fakeStorage('99999'))).toBe(MAX_WIDTH)
    expect(loadWidth(fakeStorage('nonsense'))).toBe(DEFAULT_WIDTH)
    saveWidth(99999, s)
    expect(s.value).toBe(String(MAX_WIDTH))
  })
})
