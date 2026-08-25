import { describe, it, expect } from 'vitest'
import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'
import { groupSections } from './connection-groups'

const group = (id: string, position: number, createdAt = 0): ConnectionGroup => ({
  id,
  name: `Group ${id}`,
  position,
  createdAt,
})

const conn = (id: string, groupId: string | null = null): ConnectionConfig =>
  ({ id, groupId, name: `Conn ${id}` }) as ConnectionConfig

const sectionIds = (groups: ConnectionGroup[], connections: ConnectionConfig[]): (string | null)[] =>
  groupSections(groups, connections).map((s) => s.group?.id ?? null)

describe('groupSections', () => {
  it('orders sections by position, then createdAt', () => {
    const groups = [group('b', 2, 5), group('a', 1, 9), group('c', 2, 3)]
    expect(sectionIds(groups, [])).toEqual(['a', 'c', 'b'])
  })

  it('assigns connections to their group, keeping the incoming order within a section', () => {
    const groups = [group('g1', 0), group('g2', 1)]
    const conns = [conn('x', 'g2'), conn('y', 'g1'), conn('z', 'g2')]
    const sections = groupSections(groups, conns)
    expect(sections.map((s) => s.connections.map((c) => c.id))).toEqual([['y'], ['x', 'z']])
  })

  it('includes empty groups (they are drop targets)', () => {
    const groups = [group('g1', 0), group('g2', 1)]
    const sections = groupSections(groups, [conn('x', 'g1')])
    expect(sectionIds(groups, [conn('x', 'g1')])).toEqual(['g1', 'g2'])
    expect(sections[1].connections).toEqual([])
  })

  it('appends an ungrouped section when there are ungrouped connections', () => {
    const groups = [group('g1', 0)]
    const conns = [conn('x', 'g1'), conn('y', null)]
    const sections = groupSections(groups, conns)
    expect(sections.map((s) => s.group?.id ?? null)).toEqual(['g1', null])
    expect(sections[1].connections.map((c) => c.id)).toEqual(['y'])
  })

  it('omits the ungrouped section when every connection is grouped and groups exist', () => {
    const groups = [group('g1', 0)]
    expect(sectionIds(groups, [conn('x', 'g1')])).toEqual(['g1'])
  })

  it('always shows the ungrouped section when there are no groups at all', () => {
    expect(sectionIds([], [conn('x', null)])).toEqual([null])
    expect(sectionIds([], [])).toEqual([null]) // even with zero connections
  })

  it('treats a stale groupId (matching no group) as ungrouped', () => {
    const groups = [group('g1', 0)]
    const conns = [conn('x', 'gone'), conn('y', 'g1')]
    const sections = groupSections(groups, conns)
    expect(sections.map((s) => s.group?.id ?? null)).toEqual(['g1', null])
    expect(sections[1].connections.map((c) => c.id)).toEqual(['x'])
  })

  it('does not mutate its inputs', () => {
    const groups = [group('b', 1), group('a', 0)]
    const conns = [conn('x', 'a'), conn('y', null)]
    const groupsCopy = [...groups]
    const connsCopy = [...conns]
    groupSections(groups, conns)
    expect(groups).toEqual(groupsCopy)
    expect(conns).toEqual(connsCopy)
  })
})
