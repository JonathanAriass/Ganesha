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
 *  root is promoted to a root section, and a connection whose `groupId` matches no
 *  group falls back to ungrouped. (`position` is global append order and a subgroup
 *  is always created after its parent, so parents precede children in the sort.) */
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

  const sections: GroupSection[] = []
  const rootById = new Map<string, GroupSection>()
  for (const g of ordered) {
    const section: GroupSection = { group: g, connections: byGroup.get(g.id)!, sub: [] }
    const parent = g.parentId != null ? rootById.get(g.parentId) : undefined
    if (parent) {
      parent.sub.push(section)
    } else {
      // parentId null, or stale (no such root) → root section, in position order.
      sections.push(section)
      rootById.set(g.id, section)
    }
  }
  sections.push({ group: null, connections: ungrouped, sub: [] })
  return sections
}
