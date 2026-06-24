import { describe, it, expect } from 'vitest'
import { applyTabReorder, applyTabToSide } from './tab-reorder'

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

describe('applyTabToSide — drag onto the body to split', () => {
  it('puts the dragged tab on the side and every other tab on the opposite side', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')] // not split
    const r = applyTabToSide(tabs, active('b', null), 'left', { tabId: 'b', side: 'right' })
    expect(r.tabs.find((x) => x.id === 'b')!.pane).toBe('right')
    expect(r.tabs.filter((x) => x.pane === 'left').map((x) => x.id)).toEqual(['a', 'c'])
    expect(r.activeByPane).toEqual({ left: 'a', right: 'b' }) // b active right; left's prev (b) moved → first 'a'
    expect(r.focusedPane).toBe('right')
  })

  it('keeps the previously-active tab active in the pane that keeps the rest', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    const r = applyTabToSide(tabs, active('a', null), 'left', { tabId: 'c', side: 'right' })
    expect(r.activeByPane.right).toBe('c') // dragged tab
    expect(r.activeByPane.left).toBe('a') // previously-active stays active among the rest
    expect(r.tabs.filter((x) => x.pane === 'left').map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('side=left claims the left for the dragged tab and sends the rest right', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    const r = applyTabToSide(tabs, active('a', null), 'left', { tabId: 'a', side: 'left' })
    expect(r.tabs.find((x) => x.id === 'a')!.pane).toBe('left')
    expect(r.tabs.filter((x) => x.pane === 'right').map((x) => x.id)).toEqual(['b', 'c'])
    expect(r.focusedPane).toBe('left')
    expect(r.activeByPane).toEqual({ left: 'a', right: 'b' })
  })

  it('keeps a multi-connection survivor pane pointed at a real tab', () => {
    // a(c1), b(c2), c(c1) all left, b active. Drag b(c2) to the right → left keeps a(c1)+c(c1).
    const tabs = [t('a', 'left', 'c1'), t('b', 'left', 'c2'), t('c', 'left', 'c1')]
    const r = applyTabToSide(tabs, active('b', null), 'left', { tabId: 'b', side: 'right' })
    expect(r.activeByPane.right).toBe('b')
    expect(r.activeByPane.left).toBe('a') // a real c1 tab → the store derives activeConnByPane.left = c1
  })

  it('a single tab cannot split — re-homes to left (side=right) or no-ops (side=left)', () => {
    const tabs = [t('a', 'left')]
    const rRight = applyTabToSide(tabs, active('a', null), 'left', { tabId: 'a', side: 'right' })
    expect(rRight.tabs.every((x) => x.pane === 'left')).toBe(true)
    expect(rRight.activeByPane.right).toBeNull()
    expect(applyTabToSide(tabs, active('a', null), 'left', { tabId: 'a', side: 'left' }).tabs).toBe(tabs)
  })

  it('is a no-op when every tab is already on its target side, or the id is unknown', () => {
    const split = [t('a', 'left'), t('b', 'right')]
    expect(applyTabToSide(split, active('a', 'b'), 'left', { tabId: 'b', side: 'right' }).tabs).toBe(split)
    const one = [t('a', 'left'), t('b', 'left')]
    expect(applyTabToSide(one, active('a', null), 'left', { tabId: 'zzz', side: 'right' }).tabs).toBe(one)
  })
})
