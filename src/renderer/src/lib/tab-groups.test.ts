import { describe, it, expect } from 'vitest'
import { groupTabs, visibleTabs, showScopeSwitch, effectiveTabScope } from './tab-groups'

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

describe('visibleTabs / showScopeSwitch', () => {
  const tabs = [tab('a1', 'A'), tab('a2', 'A'), tab('b1', 'B')]
  it('all scope shows every tab', () => {
    expect(visibleTabs(tabs, 'all', 'A').map((t) => t.id)).toEqual(['a1', 'a2', 'b1'])
  })
  it('connection scope shows only the active connection', () => {
    expect(visibleTabs(tabs, 'connection', 'A').map((t) => t.id)).toEqual(['a1', 'a2'])
    expect(visibleTabs(tabs, 'connection', null)).toEqual([])
  })
  it('switch shows only with tabs from 2+ connections', () => {
    expect(showScopeSwitch(tabs)).toBe(true)
    expect(showScopeSwitch(tabs.slice(0, 2))).toBe(false)
    expect(showScopeSwitch([])).toBe(false)
  })
})

describe('effectiveTabScope', () => {
  it("falls back to 'all' when the pane holds one connection (the switch is hidden)", () => {
    expect(effectiveTabScope([tab('a1', 'A'), tab('a2', 'A')], 'connection')).toBe('all')
  })
  it('keeps the chosen scope when the pane holds 2+ connections', () => {
    const two = [tab('a1', 'A'), tab('b1', 'B')]
    expect(effectiveTabScope(two, 'connection')).toBe('connection')
    expect(effectiveTabScope(two, 'all')).toBe('all')
  })
  it("is 'all' for an empty pane", () => {
    expect(effectiveTabScope([], 'connection')).toBe('all')
  })
})
