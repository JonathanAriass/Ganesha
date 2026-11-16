import { describe, it, expect } from 'vitest'
import { loadTabScope, saveTabScope, loadCollapsedGroups, saveCollapsedGroups } from './shell-prefs'

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('tab scope', () => {
  it('defaults to all and heals garbage', () => {
    expect(loadTabScope({ getItem: () => null })).toBe('all')
    expect(loadTabScope({ getItem: () => 'x' })).toBe('all')
  })
  it('reads connection', () => {
    expect(loadTabScope({ getItem: () => 'connection' })).toBe('connection')
  })
  it('round-trips through the store', () => {
    const s = memStorage()
    saveTabScope('connection', s)
    expect(loadTabScope(s)).toBe('connection')
    saveTabScope('all', s)
    expect(loadTabScope(s)).toBe('all')
  })
  it('tolerates a missing storage', () => {
    expect(loadTabScope(null)).toBe('all')
    expect(() => saveTabScope('connection', null)).not.toThrow()
  })
})

describe('collapsed groups', () => {
  it('reads a JSON string array', () => {
    expect(loadCollapsedGroups({ getItem: () => '["a","b"]' })).toEqual(['a', 'b'])
  })
  it('heals garbage to []', () => {
    expect(loadCollapsedGroups({ getItem: () => null })).toEqual([])
    expect(loadCollapsedGroups({ getItem: () => 'not json' })).toEqual([])
    expect(loadCollapsedGroups({ getItem: () => '{"a":1}' })).toEqual([])
  })
  it('drops non-string entries', () => {
    expect(loadCollapsedGroups({ getItem: () => '["a",3]' })).toEqual(['a'])
  })
  it('round-trips through the store', () => {
    const s = memStorage()
    saveCollapsedGroups(['x', 'y'], s)
    expect(loadCollapsedGroups(s)).toEqual(['x', 'y'])
  })
  it('tolerates a missing storage', () => {
    expect(loadCollapsedGroups(null)).toEqual([])
    expect(() => saveCollapsedGroups(['a'], null)).not.toThrow()
  })
})
