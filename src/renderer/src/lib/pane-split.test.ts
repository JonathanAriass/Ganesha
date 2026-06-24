import { describe, it, expect } from 'vitest'
import {
  clampPaneFraction,
  dragPaneFraction,
  loadPaneFraction,
  savePaneFraction,
  DEFAULT_PANE_FRACTION,
  MIN_PANE_FRACTION,
  MAX_PANE_FRACTION
} from './pane-split'

describe('clampPaneFraction', () => {
  it('heals garbage to the default', () => {
    expect(clampPaneFraction(NaN)).toBe(DEFAULT_PANE_FRACTION)
    expect(clampPaneFraction(Infinity)).toBe(DEFAULT_PANE_FRACTION)
  })
  it('clamps into range', () => {
    expect(clampPaneFraction(0)).toBe(MIN_PANE_FRACTION)
    expect(clampPaneFraction(1)).toBe(MAX_PANE_FRACTION)
    expect(clampPaneFraction(0.5)).toBe(0.5)
  })
})

describe('dragPaneFraction', () => {
  it('is the pointer offset into the container, clamped', () => {
    expect(dragPaneFraction(500, 0, 1000)).toBe(0.5)
    expect(dragPaneFraction(100, 100, 1000)).toBe(MIN_PANE_FRACTION) // 0 → clamps up
  })
  it('defaults on a zero-width container', () => {
    expect(dragPaneFraction(10, 0, 0)).toBe(DEFAULT_PANE_FRACTION)
  })
})

describe('load/save round-trip', () => {
  it('persists via injected storage', () => {
    const store: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v }
    }
    expect(loadPaneFraction(storage)).toBe(DEFAULT_PANE_FRACTION) // unset → default
    savePaneFraction(0.42, storage)
    expect(loadPaneFraction(storage)).toBe(0.42)
  })
})
