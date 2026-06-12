import { describe, it, expect } from 'vitest'
import {
  clampFraction,
  dragFraction,
  loadEditorFraction,
  saveEditorFraction,
  DEFAULT_EDITOR_FRACTION,
  MIN_EDITOR_FRACTION,
  MAX_EDITOR_FRACTION
} from './split'

/** Minimal in-memory Storage double — vitest runs in Node, no localStorage. */
function fakeStorage(initial?: string) {
  let value: string | null = initial ?? null
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v
    },
    get value() {
      return value
    }
  }
}

describe('clampFraction', () => {
  it('passes mid-range values through and clamps the extremes', () => {
    expect(clampFraction(0.5)).toBe(0.5)
    expect(clampFraction(0)).toBe(MIN_EDITOR_FRACTION)
    expect(clampFraction(1)).toBe(MAX_EDITOR_FRACTION)
    expect(clampFraction(-3)).toBe(MIN_EDITOR_FRACTION)
  })

  it('heals non-finite garbage to the default instead of propagating it into CSS', () => {
    expect(clampFraction(NaN)).toBe(DEFAULT_EDITOR_FRACTION)
    expect(clampFraction(Infinity)).toBe(DEFAULT_EDITOR_FRACTION)
    expect(clampFraction(-Infinity)).toBe(DEFAULT_EDITOR_FRACTION)
  })
})

describe('dragFraction', () => {
  it('maps the pointer offset into the pane over the container height', () => {
    // pane starts 40px into an 800px container; pointer 280px from the top
    // wants a 240px editor → 0.3 of the container.
    expect(dragFraction(280, 40, 800)).toBe(0.3)
  })

  it('clamps drags past either end', () => {
    expect(dragFraction(0, 40, 800)).toBe(MIN_EDITOR_FRACTION) // dragged above the pane top
    expect(dragFraction(10_000, 40, 800)).toBe(MAX_EDITOR_FRACTION)
  })

  it('returns the default for a degenerate container instead of dividing by zero', () => {
    expect(dragFraction(100, 0, 0)).toBe(DEFAULT_EDITOR_FRACTION)
    expect(dragFraction(100, 0, -5)).toBe(DEFAULT_EDITOR_FRACTION)
  })
})

describe('load/saveEditorFraction', () => {
  it('defaults when nothing is stored', () => {
    expect(loadEditorFraction(fakeStorage())).toBe(DEFAULT_EDITOR_FRACTION)
  })

  it('round-trips a saved fraction', () => {
    const storage = fakeStorage()
    saveEditorFraction(0.42, storage)
    expect(loadEditorFraction(storage)).toBe(0.42)
  })

  it('heals stored garbage and out-of-range values on load', () => {
    expect(loadEditorFraction(fakeStorage('not a number'))).toBe(DEFAULT_EDITOR_FRACTION)
    expect(loadEditorFraction(fakeStorage('0.99'))).toBe(MAX_EDITOR_FRACTION)
    expect(loadEditorFraction(fakeStorage('-1'))).toBe(MIN_EDITOR_FRACTION)
  })

  it('clamps on save too, so a buggy caller cannot persist garbage', () => {
    const storage = fakeStorage()
    saveEditorFraction(99, storage)
    expect(storage.value).toBe(String(MAX_EDITOR_FRACTION))
  })
})
