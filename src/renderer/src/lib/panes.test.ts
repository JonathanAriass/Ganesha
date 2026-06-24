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
})
