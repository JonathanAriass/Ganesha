import { describe, it, expect } from 'vitest'
import { otherPane, paneTabs, nextActiveInPane, normalizePanes, applyPaneClose } from './panes'

type T = { id: string; connectionId: string; pane: 'left' | 'right' }
const t = (id: string, pane: 'left' | 'right', connectionId = 'c1'): T => ({ id, connectionId, pane })

describe('otherPane', () => {
  it('flips left/right', () => {
    expect(otherPane('left')).toBe('right')
    expect(otherPane('right')).toBe('left')
  })
})

describe('paneTabs', () => {
  it('keeps only a pane’s tabs, order preserved', () => {
    const tabs = [t('a', 'left'), t('b', 'right'), t('c', 'left')]
    expect(paneTabs(tabs, 'left').map((x) => x.id)).toEqual(['a', 'c'])
    expect(paneTabs(tabs, 'right').map((x) => x.id)).toEqual(['b'])
  })
})

describe('nextActiveInPane', () => {
  it('prefers the survivor after the removed tab', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    expect(nextActiveInPane(tabs, 'left', 'b')).toBe('c') // c is after b
  })
  it('falls back to the survivor before when none follow', () => {
    const tabs = [t('a', 'left'), t('b', 'left')]
    expect(nextActiveInPane(tabs, 'left', 'b')).toBe('a')
  })
  it('ignores the other pane and returns null when the pane is empty', () => {
    const tabs = [t('a', 'right')]
    expect(nextActiveInPane(tabs, 'left', 'x')).toBeNull()
  })
})

describe('normalizePanes', () => {
  it('re-homes right tabs to left when left is empty', () => {
    const r = normalizePanes([t('a', 'right'), t('b', 'right')])
    expect(r.tabs.every((x) => x.pane === 'left')).toBe(true)
    expect(r.hasLeft).toBe(true)
    expect(r.hasRight).toBe(false)
  })
  it('leaves a genuine split untouched', () => {
    const r = normalizePanes([t('a', 'left'), t('b', 'right')])
    expect(r.tabs.map((x) => x.pane)).toEqual(['left', 'right'])
    expect(r.hasLeft && r.hasRight).toBe(true)
  })
  it('leaves an all-left set untouched', () => {
    const r = normalizePanes([t('a', 'left')])
    expect(r.hasRight).toBe(false)
    expect(r.tabs[0].pane).toBe('left')
  })
  it('reports both-empty for no tabs', () => {
    const r = normalizePanes([])
    expect(r).toEqual({ tabs: [], hasLeft: false, hasRight: false })
  })
})

describe('applyPaneClose', () => {
  const active = (l: string | null, r: string | null) => ({ left: l, right: r })

  it('self-close in a pane reselects the adjacent tab in that pane only', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'self', 'a')
    expect(r.tabs.map((t) => t.id)).toEqual(['b', 'x'])
    expect(r.activeByPane).toEqual({ left: 'b', right: 'x' }) // right untouched
    expect(r.focusedPane).toBe('left')
  })

  it('closing the last right tab collapses to a single left pane', () => {
    const tabs = [t('a', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'right', 'self', 'x')
    expect(r.tabs.map((t) => t.pane)).toEqual(['left'])
    expect(r.activeByPane).toEqual({ left: 'a', right: null })
    expect(r.focusedPane).toBe('left')
  })

  it('closing the last left tab re-homes the right tabs to left', () => {
    const tabs = [t('a', 'left'), t('x', 'right'), t('y', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'self', 'a')
    expect(r.tabs.every((t) => t.pane === 'left')).toBe(true)
    expect(r.tabs.map((t) => t.id)).toEqual(['x', 'y'])
    expect(r.activeByPane).toEqual({ left: 'x', right: null }) // former right-active
    expect(r.focusedPane).toBe('left')
  })

  it('"others" closes only within the target’s pane + connection', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'others', 'b')
    expect(r.tabs.map((t) => t.id)).toEqual(['b', 'x']) // a closed, x (other pane) kept
    expect(r.activeByPane.left).toBe('b')
  })

  it('is a no-op for an unknown target', () => {
    const tabs = [t('a', 'left')]
    const r = applyPaneClose(tabs, active('a', null), 'left', 'self', 'nope')
    expect(r.tabs).toBe(tabs)
  })

  it('closing in the non-focused pane keeps focus put', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'self', 'x') // focus left, close right tab
    expect(r.focusedPane).toBe('left')
    expect(r.tabs.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('leaves same-pane tabs of OTHER connections untouched', () => {
    const tabs = [t('a', 'left', 'c1'), t('b', 'left', 'c1'), t('z', 'left', 'c2')]
    const r = applyPaneClose(tabs, active('a', null), 'left', 'others', 'a')
    expect(r.tabs.map((x) => x.id)).toEqual(['a', 'z']) // b closed, z (other conn) kept
  })

  it('a pane with no active tab (a connection’s empty state) keeps none after a background close', () => {
    const tabs = [t('a', 'left', 'A'), t('b', 'left', 'A'), t('c', 'left', 'A')]
    const self = applyPaneClose(tabs, active(null, null), 'left', 'self', 'b', 'all')
    expect(self.tabs.map((x) => x.id)).toEqual(['a', 'c'])
    expect(self.activeByPane).toEqual({ left: null, right: null })
    const others = applyPaneClose(tabs, active(null, null), 'left', 'others', 'b', 'all')
    expect(others.tabs.map((x) => x.id)).toEqual(['b'])
    expect(others.activeByPane).toEqual({ left: null, right: null })
  })

  it('a split pane with no active tab keeps none; the other pane is untouched', () => {
    const tabs = [t('a', 'left', 'A'), t('b', 'left', 'A'), t('x', 'right', 'A')]
    const r = applyPaneClose(tabs, active(null, 'x'), 'left', 'self', 'a', 'all')
    expect(r.tabs.map((x) => x.id)).toEqual(['b', 'x'])
    expect(r.activeByPane).toEqual({ left: null, right: 'x' })
  })

  it('"all" clears the target pane+connection and collapses if nothing remains', () => {
    const tabs = [t('a', 'left'), t('b', 'left')]
    const r = applyPaneClose(tabs, active('a', null), 'left', 'all', 'a')
    expect(r.tabs).toEqual([])
    expect(r.activeByPane).toEqual({ left: null, right: null })
    expect(r.focusedPane).toBe('left')
  })

  describe('tabScope', () => {
    // left: a1,a2 (A), b1 (B); right: a3 (A), c1 (C)
    const mk = () => [t('a1', 'left', 'A'), t('a2', 'left', 'A'), t('b1', 'left', 'B'), t('a3', 'right', 'A'), t('c1', 'right', 'C')]
    const ids = (r: { tabs: T[] }) => r.tabs.map((x) => x.id)

    it("'others' with scope 'all' keeps only the target in its pane", () => {
      const r = applyPaneClose(mk(), active('a1', 'a3'), 'left', 'others', 'a1', 'all')
      expect(ids(r)).toEqual(['a1', 'a3', 'c1'])
    })

    it("'all' with scope 'all' closes the whole pane, the other pane survives", () => {
      const r = applyPaneClose(mk(), active('a1', 'a3'), 'left', 'all', 'a1', 'all')
      for (const gone of ['a1', 'a2', 'b1']) expect(ids(r)).not.toContain(gone)
      expect(ids(r)).toContain('a3')
      expect(ids(r)).toContain('c1')
    })

    it("'others' with scope 'connection' keeps other connections (default)", () => {
      const r = applyPaneClose(mk(), active('a1', 'a3'), 'left', 'others', 'a1', 'connection')
      expect(ids(r)).toEqual(['a1', 'b1', 'a3', 'c1'])
      expect(ids(applyPaneClose(mk(), active('a1', 'a3'), 'left', 'others', 'a1'))).toEqual(['a1', 'b1', 'a3', 'c1'])
    })

    it("'right' with scope 'all' closes everything right of the target in its pane", () => {
      const r = applyPaneClose(mk(), active('a1', 'a3'), 'left', 'right', 'a1', 'all')
      expect(ids(r)).toEqual(['a1', 'a3', 'c1'])
    })
  })
})
