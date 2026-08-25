import { describe, it, expect } from 'vitest'
import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'
import { groupSections } from './connection-groups'

const group = (id: string, position: number, createdAt = 0, parentId: string | null = null): ConnectionGroup => ({
  id,
  name: `Group ${id}`,
  parentId,
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
    expect(sectionIds(groups, [])).toEqual(['a', 'c', 'b', null])
  })

  it('assigns connections to their group, keeping the incoming order within a section', () => {
    const groups = [group('g1', 0), group('g2', 1)]
    const conns = [conn('x', 'g2'), conn('y', 'g1'), conn('z', 'g2')]
    const sections = groupSections(groups, conns)
    expect(sections.map((s) => s.connections.map((c) => c.id))).toEqual([['y'], ['x', 'z'], []])
  })

  it('includes empty groups (they are drop targets)', () => {
    const groups = [group('g1', 0), group('g2', 1)]
    const sections = groupSections(groups, [conn('x', 'g1')])
    expect(sectionIds(groups, [conn('x', 'g1')])).toEqual(['g1', 'g2', null])
    expect(sections[1].connections).toEqual([])
  })

  it('puts ungrouped connections in the trailing ungrouped section', () => {
    const groups = [group('g1', 0)]
    const conns = [conn('x', 'g1'), conn('y', null)]
    const sections = groupSections(groups, conns)
    expect(sections.map((s) => s.group?.id ?? null)).toEqual(['g1', null])
    expect(sections[1].connections.map((c) => c.id)).toEqual(['y'])
  })

  it('always appends the ungrouped section when groups exist — even empty (the un-group drop target)', () => {
    const groups = [group('g1', 0)]
    const sections = groupSections(groups, [conn('x', 'g1')])
    expect(sections.map((s) => s.group?.id ?? null)).toEqual(['g1', null])
    expect(sections[1].connections).toEqual([])
  })

  it('keeps the ungrouped section last, after every group', () => {
    const groups = [group('g2', 1), group('g1', 0)]
    const conns = [conn('y', null), conn('x', 'g2')]
    expect(sectionIds(groups, conns)).toEqual(['g1', 'g2', null])
  })

  it('returns exactly one ungrouped section when there are no groups (rendered headerless)', () => {
    expect(sectionIds([], [conn('x', null)])).toEqual([null])
    expect(sectionIds([], [])).toEqual([null]) // even with zero connections
  })

  it('nests subgroups under their parent in position order; only roots are top-level sections', () => {
    const groups = [
      group('a', 0),
      group('b', 1),
      group('a2', 3, 0, 'a'), // appended after a1 but under the same parent
      group('a1', 2, 0, 'a'),
      group('b1', 4, 0, 'b'),
    ]
    const sections = groupSections(groups, [])
    expect(sections.map((s) => s.group?.id ?? null)).toEqual(['a', 'b', null])
    expect(sections[0].sub.map((s) => s.group?.id)).toEqual(['a1', 'a2'])
    expect(sections[1].sub.map((s) => s.group?.id)).toEqual(['b1'])
  })

  it('sub is always [] on subgroup sections and the ungrouped section', () => {
    const groups = [group('a', 0), group('a1', 1, 0, 'a')]
    const sections = groupSections(groups, [conn('x', null)])
    expect(sections[0].sub[0].sub).toEqual([])
    expect(sections[sections.length - 1].group).toBeNull()
    expect(sections[sections.length - 1].sub).toEqual([])
  })

  it('promotes a group with a stale parentId (matching no group) to root — never dropped', () => {
    const groups = [group('a', 0), group('orphan', 1, 0, 'ghost')]
    const sections = groupSections(groups, [conn('x', 'orphan')])
    expect(sections.map((s) => s.group?.id ?? null)).toEqual(['a', 'orphan', null])
    expect(sections[1].connections.map((c) => c.id)).toEqual(['x'])
    expect(sections[1].sub).toEqual([])
  })

  it('assigns connections to subgroup sections wherever they sit', () => {
    const groups = [group('a', 0), group('a1', 1, 0, 'a')]
    const conns = [conn('x', 'a1'), conn('y', 'a'), conn('z', null)]
    const sections = groupSections(groups, conns)
    expect(sections[0].connections.map((c) => c.id)).toEqual(['y'])
    expect(sections[0].sub[0].connections.map((c) => c.id)).toEqual(['x'])
    expect(sections[1].connections.map((c) => c.id)).toEqual(['z']) // ungrouped, still last
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

describe('order independence', () => {
  it('nests a child that sorts BEFORE its parent (future reorder APIs must not flatten it)', () => {
    // Inverted positions: the child carries position 0, the parent 1.
    const parent = { id: 'p', name: 'Prod', position: 1, createdAt: 2, parentId: null }
    const child = { id: 'c', name: 'EU', position: 0, createdAt: 1, parentId: 'p' }
    const out = groupSections([parent, child], [])
    expect(out.map((s) => s.group?.id ?? null)).toEqual(['p', null])
    expect(out[0].sub.map((s) => s.group?.id)).toEqual(['c'])
  })
})
