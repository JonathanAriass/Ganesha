import { describe, it, expect } from 'vitest'
import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'
import { groupSections, sidebarRows } from './connection-groups'

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

describe('sidebarRows', () => {
  const groups = [group('work', 0), group('staging', 0, 1, 'work')]
  const conns = [conn('p', 'work'), conn('s', 'staging'), conn('l')]
  const rows = (collapsed: string[] = [], g = groups, c = conns) =>
    sidebarRows(groupSections(g, c), new Set(collapsed))

  it('nothing collapsed: headers, indented connections, ungrouped last', () => {
    const r = rows()
    expect(r.map((x) => x.kind)).toEqual(['group', 'connection', 'group', 'connection', 'connection'])
    expect(r.map((x) => x.depth)).toEqual([0, 1, 1, 2, 0])
    const [work, p, staging, s, l] = r
    expect(work).toMatchObject({ kind: 'group', collapsed: false, count: 2 })
    expect(work.kind === 'group' && work.group.id).toBe('work')
    expect(p.kind === 'connection' && p.connection.id).toBe('p')
    expect(staging).toMatchObject({ kind: 'group', collapsed: false, count: 1 })
    expect(staging.kind === 'group' && staging.group.id).toBe('staging')
    expect(s.kind === 'connection' && s.connection.id).toBe('s')
    expect(l.kind === 'connection' && l.connection.id).toBe('l')
  })

  it('collapsed root hides its connections and subgroups', () => {
    const r = rows(['work'])
    expect(r.map((x) => x.kind)).toEqual(['group', 'connection'])
    expect(r[0]).toMatchObject({ kind: 'group', depth: 0, collapsed: true, count: 2 })
    expect(r[1]).toMatchObject({ kind: 'connection', depth: 0 })
    expect(r[1].kind === 'connection' && r[1].connection.id).toBe('l')
  })

  it('collapsed subgroup keeps its header but hides its connections', () => {
    const r = rows(['staging'])
    expect(r.map((x) => x.kind)).toEqual(['group', 'connection', 'group', 'connection'])
    expect(r[2]).toMatchObject({ kind: 'group', depth: 1, collapsed: true, count: 1 })
    expect(r[2].kind === 'group' && r[2].group.id).toBe('staging')
    expect(r[3].kind === 'connection' && r[3].connection.id).toBe('l')
  })

  it('no groups: just the connections at depth 0, no header row', () => {
    const r = rows([], [], conns)
    expect(r.every((x) => x.kind === 'connection' && x.depth === 0)).toBe(true)
    expect(r.map((x) => x.kind === 'connection' && x.connection.id)).toEqual(['p', 's', 'l'])
  })

  it('an empty group still yields its header with count 0', () => {
    const r = rows([], [group('empty', 0)], [])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'group', depth: 0, collapsed: false, count: 0 })
  })
})
