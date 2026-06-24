import { describe, it, expect } from 'vitest'
import { groupTabs } from './tab-groups'

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
