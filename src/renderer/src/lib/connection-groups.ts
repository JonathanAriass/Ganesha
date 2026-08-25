import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'

/** dataTransfer key carrying the dragged connection's id (dashboard card → group section). */
export const CONN_MIME = 'application/x-ganesha-connection'

/** One dashboard section: a group's connections, or the trailing ungrouped bucket
 *  (`group: null`). Empty groups still get a section — they're drop targets. */
export interface GroupSection {
  group: ConnectionGroup | null
  connections: ConnectionConfig[]
}

/** Arrange the dashboard: one section per group ordered by `position` (ties broken by
 *  `createdAt`), each holding its connections in the incoming order, plus the
 *  ungrouped section ALWAYS last. With no groups it is the only section (the
 *  dashboard renders it headerless — today's pre-groups look); with groups it is
 *  present even when empty, so there is always a drop target to un-group a card.
 *  A connection whose `groupId` matches no known group (stale — e.g. the group was
 *  deleted under it) falls back to ungrouped rather than vanishing. */
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
  const sections: GroupSection[] = ordered.map((g) => ({
    group: g,
    connections: byGroup.get(g.id)!,
  }))
  sections.push({ group: null, connections: ungrouped })
  return sections
}
