import { describe, it, expect } from 'vitest'
import { parseDensity, densityHint, DENSITY_METRICS } from './density'

describe('density', () => {
  it('parseDensity accepts the two densities and heals anything else', () => {
    expect(parseDensity('compact')).toBe('compact')
    expect(parseDensity('comfortable')).toBe('comfortable')
    expect(parseDensity('cozy')).toBe('comfortable')
    expect(parseDensity(null)).toBe('comfortable')
  })
  it('densityHint reads the stored hint, healing garbage', () => {
    expect(densityHint({ getItem: () => 'compact' })).toBe('compact')
    expect(densityHint({ getItem: () => 'garbage' })).toBe('comfortable')
    expect(densityHint(null)).toBe('comfortable')
  })
  it('densityHint falls back to comfortable when storage throws', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('SecurityError')
      }
    }
    expect(densityHint(throwing)).toBe('comfortable')
  })
  it('densityHint falls back to comfortable when localStorage itself cannot be accessed', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      }
    })
    try {
      expect(densityHint()).toBe('comfortable')
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
  it('exposes the JS-side metrics', () => {
    expect(DENSITY_METRICS.compact).toEqual({ editorFontSize: 13, gridRowHeight: 26 })
    expect(DENSITY_METRICS.comfortable).toEqual({ editorFontSize: 14, gridRowHeight: 40 })
  })
})
