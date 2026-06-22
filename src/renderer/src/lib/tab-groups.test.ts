import { describe, it, expect } from 'vitest'
import { groupTabs, nextActiveForGroup, applyGroupedTabClose } from './tab-groups'

type T = { id: string; connectionId: string }
const tab = (id: string, c: string): T => ({ id, connectionId: c })

describe('groupTabs', () => {
  it('groups by connection, ordered by first appearance, preserving tab order', () => {
    const tabs = [tab('1', 'local'), tab('2', 'prod'), tab('3', 'local'), tab('4', 'prod')]
    expect(groupTabs(tabs)).toEqual([
      { connectionId: 'local', tabs: [tab('1', 'local'), tab('3', 'local')] },
      { connectionId: 'prod', tabs: [tab('2', 'prod'), tab('4', 'prod')] },
    ])
  })
  it('empty → no groups', () => {
    expect(groupTabs([])).toEqual([])
  })
})

describe('nextActiveForGroup', () => {
  const tabs = [tab('1', 'local'), tab('2', 'prod'), tab('3', 'local')]
  it('returns the remembered tab when it is still in the group', () => {
    expect(nextActiveForGroup(tabs, 'local', { local: '3' })).toBe('3')
  })
  it('falls back to the group first tab when the remembered tab is gone', () => {
    expect(nextActiveForGroup(tabs, 'local', { local: 'zzz' })).toBe('1')
  })
  it('falls back to the first tab when nothing is remembered', () => {
    expect(nextActiveForGroup(tabs, 'prod', {})).toBe('2')
  })
  it('null when the connection has no tabs', () => {
    expect(nextActiveForGroup(tabs, 'staging', { staging: 'x' })).toBeNull()
  })
})

describe('applyGroupedTabClose', () => {
  // local: [a, b, c], prod: [x, y]   (interleaved in the flat array)
  const tabs = [tab('a', 'local'), tab('x', 'prod'), tab('b', 'local'), tab('y', 'prod'), tab('c', 'local')]

  it("self: closing the active tab selects the next tab in the SAME group", () => {
    const r = applyGroupedTabClose(tabs, 'b', 'self', 'b')
    expect(r.tabs.map((t) => t.id)).toEqual(['a', 'x', 'y', 'c'])
    expect(r.activeId).toBe('c') // next within local, not the interleaved 'y'
  })
  it('self: closing the last group tab selects the previous one in the group', () => {
    expect(applyGroupedTabClose(tabs, 'c', 'self', 'c').activeId).toBe('b')
  })
  it('self: closing a NON-active tab keeps the active tab', () => {
    expect(applyGroupedTabClose(tabs, 'a', 'self', 'c').activeId).toBe('a')
  })
  it('others: keeps only the target in its group; other groups untouched', () => {
    const r = applyGroupedTabClose(tabs, 'a', 'others', 'b')
    expect(r.tabs.map((t) => t.id)).toEqual(['x', 'b', 'y'])
    expect(r.activeId).toBe('b')
  })
  it('right: closes group tabs after the target only', () => {
    const r = applyGroupedTabClose(tabs, 'c', 'right', 'a')
    expect(r.tabs.map((t) => t.id)).toEqual(['a', 'x', 'y']) // b,c gone; prod intact
    expect(r.activeId).toBe('a')
  })
  it('left: closes group tabs before the target only', () => {
    const r = applyGroupedTabClose(tabs, 'a', 'left', 'c')
    expect(r.tabs.map((t) => t.id)).toEqual(['x', 'y', 'c'])
    expect(r.activeId).toBe('c')
  })
  it('all: empties the group, active falls to the first remaining tab (another group)', () => {
    const r = applyGroupedTabClose(tabs, 'b', 'all', 'b')
    expect(r.tabs.map((t) => t.id)).toEqual(['x', 'y'])
    expect(r.activeId).toBe('x')
  })
  it('all on the only group → no tabs, active null', () => {
    const one = [tab('a', 'local'), tab('b', 'local')]
    expect(applyGroupedTabClose(one, 'a', 'all', 'a')).toEqual({ tabs: [], activeId: null })
  })
  it('active in another group survives any close in the target group', () => {
    expect(applyGroupedTabClose(tabs, 'x', 'all', 'b').activeId).toBe('x')
  })
  it('unknown target id is a no-op', () => {
    expect(applyGroupedTabClose(tabs, 'a', 'self', 'zzz')).toEqual({ tabs, activeId: 'a' })
  })
})
