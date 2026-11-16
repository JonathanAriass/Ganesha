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
  it('exposes the JS-side metrics', () => {
    expect(DENSITY_METRICS.compact).toEqual({ editorFontSize: 13, gridRowHeight: 26 })
    expect(DENSITY_METRICS.comfortable).toEqual({ editorFontSize: 14, gridRowHeight: 40 })
  })
})
