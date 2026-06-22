import { describe, it, expect } from 'vitest'
import { applyTabClose } from './tab-close'

const tabs = (...ids: string[]): { id: string }[] => ids.map((id) => ({ id }))

describe('applyTabClose', () => {
  it("all: removes every tab, active → null", () => {
    expect(applyTabClose(tabs('a', 'b', 'c'), 'b', 'all', 'b')).toEqual({ tabs: [], activeId: null })
  })

  it('others: keeps only the target, which becomes active', () => {
    expect(applyTabClose(tabs('a', 'b', 'c'), 'a', 'others', 'b')).toEqual({
      tabs: tabs('b'),
      activeId: 'b',
    })
  })

  it('right: keeps the target and everything left of it', () => {
    expect(applyTabClose(tabs('a', 'b', 'c', 'd'), 'a', 'right', 'b')).toEqual({
      tabs: tabs('a', 'b'),
      activeId: 'a',
    })
  })

  it('right: when the active tab was to the right, active falls back to the target', () => {
    expect(applyTabClose(tabs('a', 'b', 'c', 'd'), 'd', 'right', 'b')).toEqual({
      tabs: tabs('a', 'b'),
      activeId: 'b',
    })
  })

  it('left: keeps the target and everything right of it', () => {
    expect(applyTabClose(tabs('a', 'b', 'c', 'd'), 'd', 'left', 'c')).toEqual({
      tabs: tabs('c', 'd'),
      activeId: 'd',
    })
  })

  it('left: when the active tab was to the left, active falls back to the target', () => {
    expect(applyTabClose(tabs('a', 'b', 'c', 'd'), 'a', 'left', 'c')).toEqual({
      tabs: tabs('c', 'd'),
      activeId: 'c',
    })
  })

  it('keeps the current active tab when it survives', () => {
    expect(applyTabClose(tabs('a', 'b', 'c'), 'a', 'right', 'a').activeId).toBe('a')
  })

  it('right on the last tab is a no-op set (nothing to the right)', () => {
    expect(applyTabClose(tabs('a', 'b', 'c'), 'c', 'right', 'c')).toEqual({
      tabs: tabs('a', 'b', 'c'),
      activeId: 'c',
    })
  })

  it('unknown target id is a no-op for targeted modes', () => {
    expect(applyTabClose(tabs('a', 'b'), 'a', 'others', 'zzz')).toEqual({
      tabs: tabs('a', 'b'),
      activeId: 'a',
    })
  })

  it('self: closes just the target, keeping the active tab when a different one is closed', () => {
    expect(applyTabClose(tabs('a', 'b', 'c'), 'a', 'self', 'b')).toEqual({
      tabs: tabs('a', 'c'),
      activeId: 'a',
    })
  })
  it('self: closing the active tab reselects the first remaining', () => {
    expect(applyTabClose(tabs('a', 'b', 'c'), 'b', 'self', 'b').activeId).toBe('a')
  })
})
