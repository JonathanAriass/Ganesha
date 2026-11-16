import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'

/** dataTransfer key carrying the dragged connection's id (dashboard card → group section). */
export const CONN_MIME = 'application/x-ganesha-connection'

/** One dashboard section: a group's connections plus its subgroup sections, or the
 *  trailing ungrouped bucket (`group: null`). Empty groups still get a section —
 *  they're drop targets. `sub` is only ever populated on root-group sections; it is
 *  always [] on subgroup sections (max depth 2) and on the ungrouped section. */
export interface GroupSection {
  group: ConnectionGroup | null
  connections: ConnectionConfig[]
  sub: GroupSection[]
}

/** Arrange the dashboard: one section per ROOT group ordered by `position` (ties
 *  broken by `createdAt`), each carrying its subgroups in `sub` (same order) and its
 *  connections in the incoming order, plus the ungrouped section ALWAYS last. With
 *  no groups the ungrouped section is the only one (the dashboard renders it
 *  headerless — the pre-groups look); with groups it is present even when empty, so
 *  there is always a drop target to un-group a card.
 *
 *  Stale references never drop data: a group whose `parentId` matches no existing
 *  group is promoted to a root section, and a connection whose `groupId` matches no
 *  group falls back to ungrouped. The tree build is two-pass (roots first, then
 *  attach children by id), so it does NOT depend on parents sorting before children —
 *  a future group-reorder API can't silently flatten the tree. */
export function groupSections(
  groups: ConnectionGroup[],
  connections: ConnectionConfig[]
): GroupSection[] {
  const ordered = [...groups].sort(
    (a, b) => a.position - b.position || a.createdAt - b.createdAt
  )
  const byGroup = new Map<string, ConnectionConfig[]>(ordered.map((g) => [g.id, []]))
  const ungrouped: ConnectionConfig[] = []
  for (const c of connections) {
    const bucket = c.groupId != null ? byGroup.get(c.groupId) : undefined
    if (bucket) bucket.push(c)
    else ungrouped.push(c) // null groupId, or stale id pointing at no group
  }

  // A root is a group with no parent, or whose parent doesn't exist (stale → promoted).
  const ids = new Set(ordered.map((g) => g.id))
  const isRoot = (g: ConnectionGroup): boolean => g.parentId == null || !ids.has(g.parentId)

  // Pass 1: root sections in position order. Pass 2: attach children by parent id —
  // a child whose parent is itself a child (corrupt depth>2 data) promotes to root
  // rather than vanishing.
  const sections: GroupSection[] = []
  const rootById = new Map<string, GroupSection>()
  for (const g of ordered) {
    if (!isRoot(g)) continue
    const section: GroupSection = { group: g, connections: byGroup.get(g.id)!, sub: [] }
    sections.push(section)
    rootById.set(g.id, section)
  }
  for (const g of ordered) {
    if (isRoot(g)) continue
    const section: GroupSection = { group: g, connections: byGroup.get(g.id)!, sub: [] }
    const parent = rootById.get(g.parentId!)
    if (parent) parent.sub.push(section)
    else sections.push(section)
  }
  sections.push({ group: null, connections: ungrouped, sub: [] })
  return sections
}

export type SidebarRow =
  | { kind: 'group'; group: ConnectionGroup; depth: 0 | 1; collapsed: boolean; count: number }
  | { kind: 'connection'; connection: ConnectionConfig; depth: 0 | 1 | 2 }

/** Flatten the group sections into the sidebar's row list. A group row's `count` is
 *  its own connections plus its subgroups'. Collapsed groups keep their header but
 *  hide everything beneath. The ungrouped section (`group: null`) has no header; its
 *  connections sit at depth 0. */
export function sidebarRows(sections: GroupSection[], collapsed: ReadonlySet<string>): SidebarRow[] {
  const rows: SidebarRow[] = []
  for (const s of sections) {
    if (s.group === null) {
      for (const c of s.connections) rows.push({ kind: 'connection', connection: c, depth: 0 })
      continue
    }
    const count = s.connections.length + s.sub.reduce((n, x) => n + x.connections.length, 0)
    const isCollapsed = collapsed.has(s.group.id)
    rows.push({ kind: 'group', group: s.group, depth: 0, collapsed: isCollapsed, count })
    if (isCollapsed) continue
    for (const c of s.connections) rows.push({ kind: 'connection', connection: c, depth: 1 })
    for (const sub of s.sub) {
      const subCollapsed = collapsed.has(sub.group!.id)
      rows.push({
        kind: 'group',
        group: sub.group!,
        depth: 1,
        collapsed: subCollapsed,
        count: sub.connections.length
      })
      if (subCollapsed) continue
      for (const c of sub.connections) rows.push({ kind: 'connection', connection: c, depth: 2 })
    }
  }
  return rows
}
