import { describe, it, expect } from 'vitest'
import { loadTabScope, saveTabScope, loadCollapsedGroups, saveCollapsedGroups,
  clampSidebarSplit, dragSidebarSplit, loadSidebarSplit, saveSidebarSplit,
  SIDEBAR_SPLIT_DEFAULT, SIDEBAR_SPLIT_MIN, SIDEBAR_SPLIT_MAX
} from './shell-prefs'

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

describe('sidebar split', () => {
  it('defaults when nothing is stored or the value is garbage', () => {
    expect(loadSidebarSplit({ getItem: () => null })).toBe(SIDEBAR_SPLIT_DEFAULT)
    expect(loadSidebarSplit({ getItem: () => '' })).toBe(SIDEBAR_SPLIT_DEFAULT)
    expect(loadSidebarSplit({ getItem: () => 'abc' })).toBe(SIDEBAR_SPLIT_DEFAULT)
    expect(loadSidebarSplit(null)).toBe(SIDEBAR_SPLIT_DEFAULT)
  })
  it('clamps to the allowed range', () => {
    expect(clampSidebarSplit(0.01)).toBe(SIDEBAR_SPLIT_MIN)
    expect(clampSidebarSplit(0.99)).toBe(SIDEBAR_SPLIT_MAX)
    expect(clampSidebarSplit(0.5)).toBe(0.5)
    expect(loadSidebarSplit({ getItem: () => '5' })).toBe(SIDEBAR_SPLIT_MAX)
  })
  it('maps a pointer position to a share of the sidebar height', () => {
    expect(dragSidebarSplit(360, 60, 1000)).toBeCloseTo(0.3)
    expect(dragSidebarSplit(0, 60, 1000)).toBe(SIDEBAR_SPLIT_MIN)
    expect(dragSidebarSplit(2000, 60, 1000)).toBe(SIDEBAR_SPLIT_MAX)
    expect(dragSidebarSplit(100, 60, 0)).toBe(SIDEBAR_SPLIT_DEFAULT)
  })
  it('round-trips through the store', () => {
    const s = memStorage()
    saveSidebarSplit(0.6, s)
    expect(loadSidebarSplit(s)).toBe(0.6)
    expect(() => saveSidebarSplit(0.6, null)).not.toThrow()
  })
})
