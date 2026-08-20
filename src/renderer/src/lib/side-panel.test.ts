import { describe, it, expect } from 'vitest'
import {
  clampSideWidth, dragSideWidth, loadSideWidth, saveSideWidth,
  loadSideOpen, saveSideOpen, loadSideSection, saveSideSection,
  SIDE_DEFAULT_WIDTH, SIDE_MIN_WIDTH, SIDE_MAX_WIDTH
} from './side-panel'

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('clampSideWidth', () => {
  it('clamps into range and rounds', () => {
    expect(clampSideWidth(100)).toBe(SIDE_MIN_WIDTH)
    expect(clampSideWidth(9999)).toBe(SIDE_MAX_WIDTH)
    expect(clampSideWidth(300.6)).toBe(301)
  })
  it('heals garbage to the default', () => {
    expect(clampSideWidth(NaN)).toBe(SIDE_DEFAULT_WIDTH)
    expect(clampSideWidth(Infinity)).toBe(SIDE_DEFAULT_WIDTH)
  })
})

describe('dragSideWidth', () => {
  // Left-docked panel: width = pointer − the panel's fixed LEFT edge.
  it('derives width from pointer minus panel left', () => {
    expect(dragSideWidth(352, 52)).toBe(300)
  })
  it('clamps the derived width', () => {
    expect(dragSideWidth(5000, 52)).toBe(SIDE_MAX_WIDTH)
  })
})

describe('width persistence', () => {
  it('defaults when unset, round-trips, clamps stored garbage', () => {
    const s = memStorage()
    expect(loadSideWidth(s)).toBe(SIDE_DEFAULT_WIDTH)
    saveSideWidth(333, s)
    expect(loadSideWidth(s)).toBe(333)
    expect(loadSideWidth(memStorage({ 'side-width': 'junk' }))).toBe(SIDE_DEFAULT_WIDTH)
  })
})

describe('open/section persistence', () => {
  it('open defaults true; only the literal "false" closes it', () => {
    expect(loadSideOpen(memStorage())).toBe(true)
    expect(loadSideOpen(memStorage({ 'side-open': 'false' }))).toBe(false)
    expect(loadSideOpen(memStorage({ 'side-open': 'garbage' }))).toBe(true)
    const s = memStorage()
    saveSideOpen(false, s)
    expect(loadSideOpen(s)).toBe(false)
  })
  it('section defaults to schema and rejects unknown values', () => {
    expect(loadSideSection(memStorage())).toBe('schema')
    expect(loadSideSection(memStorage({ 'side-section': 'saved' }))).toBe('saved')
    expect(loadSideSection(memStorage({ 'side-section': 'bogus' }))).toBe('schema')
    const s = memStorage()
    saveSideSection('history', s)
    expect(loadSideSection(s)).toBe('history')
  })
})

describe('default storage guard (node env)', () => {
  it('no-arg loads return defaults and no-arg saves do not throw without localStorage', () => {
    expect(loadSideWidth()).toBe(SIDE_DEFAULT_WIDTH)
    expect(loadSideOpen()).toBe(true)
    expect(loadSideSection()).toBe('schema')
    expect(() => saveSideOpen(true)).not.toThrow()
  })
  it('save clamps out-of-range widths', () => {
    const s = memStorage()
    saveSideWidth(99999, s)
    expect(loadSideWidth(s)).toBe(SIDE_MAX_WIDTH)
  })
})
