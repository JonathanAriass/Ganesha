import { describe, it, expect } from 'vitest'
import { applyTabReorder } from './tab-reorder'

type T = { id: string; connectionId: string; pane: 'left' | 'right' }
const t = (id: string, pane: 'left' | 'right', connectionId = 'c1'): T => ({ id, connectionId, pane })
const active = (l: string | null, r: string | null): Record<'left' | 'right', string | null> => ({ left: l, right: r })

describe('applyTabReorder — within one pane', () => {
  it('moves a middle tab to the end (beforeId null = append)', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    const r = applyTabReorder(tabs, active('b', null), 'left', { tabId: 'b', toPane: 'left', beforeId: null })
    expect(r.tabs.map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(r.activeByPane).toEqual({ left: 'b', right: null }) // moved tab stays active
    expect(r.focusedPane).toBe('left')
  })

  it('moves a tab to the front (insert before the first)', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    const r = applyTabReorder(tabs, active('a', null), 'left', { tabId: 'c', toPane: 'left', beforeId: 'a' })
    expect(r.tabs.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op (same refs) when the drop lands in the same spot', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    const r = applyTabReorder(tabs, active('b', null), 'left', { tabId: 'b', toPane: 'left', beforeId: 'c' })
    expect(r.tabs).toBe(tabs) // unchanged reference → store short-circuits
  })

  it('is a no-op when beforeId === tabId or the id is unknown', () => {
    const tabs = [t('a', 'left'), t('b', 'left')]
    expect(applyTabReorder(tabs, active('a', null), 'left', { tabId: 'b', toPane: 'left', beforeId: 'b' }).tabs).toBe(tabs)
    expect(applyTabReorder(tabs, active('a', null), 'left', { tabId: 'zzz', toPane: 'left', beforeId: 'a' }).tabs).toBe(tabs)
  })
})

describe('applyTabReorder — across panes', () => {
  it('moves a tab into the other pane and focuses it there', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'right')]
    const r = applyTabReorder(tabs, active('b', 'c'), 'left', { tabId: 'b', toPane: 'right', beforeId: 'c' })
    expect(r.tabs.find((x) => x.id === 'b')!.pane).toBe('right')
    expect(r.tabs.map((x) => x.id)).toEqual(['a', 'b', 'c']) // b inserted before c in the flat array
    expect(r.focusedPane).toBe('right')
    expect(r.activeByPane).toEqual({ left: 'a', right: 'b' }) // left reselects a survivor; b active on the right
  })

  it('reselects the source pane active from a survivor (used by the store to avoid a stale conn)', () => {
    // left has two connections: a(c1), b(c2) with b active. Moving b away → a is the survivor.
    const tabs = [t('a', 'left', 'c1'), t('b', 'left', 'c2'), t('c', 'right', 'c1')]
    const r = applyTabReorder(tabs, active('b', 'c'), 'left', { tabId: 'b', toPane: 'right', beforeId: 'c' })
    expect(r.activeByPane.left).toBe('a') // c1 survivor; the store derives activeConnByPane.left = c1
    expect(r.activeByPane.right).toBe('b')
  })

  it('collapses to a single left pane when the moved tab was the last on its side', () => {
    const tabs = [t('a', 'left'), t('b', 'right')]
    const r = applyTabReorder(tabs, active('a', 'b'), 'left', { tabId: 'b', toPane: 'left', beforeId: 'a' })
    expect(r.tabs.every((x) => x.pane === 'left')).toBe(true)
    expect(r.tabs.map((x) => x.id)).toEqual(['b', 'a'])
    expect(r.activeByPane).toEqual({ left: 'b', right: null })
    expect(r.focusedPane).toBe('left')
  })

  it('re-homes the right tabs to left when the moved tab empties the left pane', () => {
    const tabs = [t('a', 'left'), t('b', 'right')]
    const r = applyTabReorder(tabs, active('a', 'b'), 'left', { tabId: 'a', toPane: 'right', beforeId: 'b' })
    expect(r.tabs.every((x) => x.pane === 'left')).toBe(true) // left emptied → collapse
    expect(r.focusedPane).toBe('left')
    expect(r.activeByPane.right).toBeNull()
  })
})
