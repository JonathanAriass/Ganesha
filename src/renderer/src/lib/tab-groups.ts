import { applyTabClose, type CloseMode } from './tab-close'

/** Query tabs grouped by the connection (server) they belong to. Groups are a derived view over
 *  the flat tabs array — there is no parallel data structure. Pure helpers; the store wraps them. */

export interface TabGroup<T> {
  connectionId: string
  tabs: T[]
}

/** Group tabs by connection, ordered by each connection's first appearance; tab order preserved. */
export function groupTabs<T extends { connectionId: string }>(tabs: T[]): TabGroup<T>[] {
  const order: string[] = []
  const byConn = new Map<string, T[]>()
  for (const t of tabs) {
    let bucket = byConn.get(t.connectionId)
    if (!bucket) {
      bucket = []
      byConn.set(t.connectionId, bucket)
      order.push(t.connectionId)
    }
    bucket.push(t)
  }
  return order.map((connectionId) => ({ connectionId, tabs: byConn.get(connectionId)! }))
}

/** The tab to activate when switching to a connection's group: the last-active tab if it's still
 *  in the group, else the group's first tab, else null (the connection has no open tabs). */
export function nextActiveForGroup<T extends { id: string; connectionId: string }>(
  tabs: T[],
  connectionId: string,
  lastActive: Record<string, string>
): string | null {
  const group = tabs.filter((t) => t.connectionId === connectionId)
  if (group.length === 0) return null
  const remembered = lastActive[connectionId]
  if (remembered && group.some((t) => t.id === remembered)) return remembered
  return group[0].id
}

/** Close tabs scoped to the TARGET tab's group, then recombine with the other groups' tabs
 *  (order preserved) and reselect the active tab. `mode 'self'` closes just the target; the rest
 *  match the right-click menu. Reselection: keep the active tab if it survives (including when it
 *  was in another group); else the nearest surviving tab in the group (after the target, else
 *  before); else the first remaining tab in another group; else null. */
export function applyGroupedTabClose<T extends { id: string; connectionId: string }>(
  tabs: T[],
  activeId: string | null,
  mode: CloseMode,
  targetId: string
): { tabs: T[]; activeId: string | null } {
  const target = tabs.find((t) => t.id === targetId)
  if (!target) return { tabs, activeId } // unknown target → no-op (every mode here is group-scoped)
  const conn = target.connectionId
  const group = tabs.filter((t) => t.connectionId === conn)
  const gIdx = group.findIndex((t) => t.id === targetId)

  // Survivors within the group (activeId is irrelevant to the survivor set — we discard its activeId).
  const keptGroup = applyTabClose(group, activeId, mode, targetId).tabs
  const keptIds = new Set(keptGroup.map((t) => t.id))
  const nextTabs = tabs.filter((t) => t.connectionId !== conn || keptIds.has(t.id))

  let nextActive: string | null
  if (activeId !== null && nextTabs.some((t) => t.id === activeId)) {
    nextActive = activeId // a non-active tab was closed, or the active tab is in another group
  } else if (keptGroup.length > 0) {
    const after = group.slice(gIdx + 1).find((t) => keptIds.has(t.id))
    const before = group.slice(0, gIdx).reverse().find((t) => keptIds.has(t.id))
    nextActive = (after ?? before ?? keptGroup[0]).id
  } else {
    nextActive = nextTabs[0]?.id ?? null // the group emptied → first remaining tab, else nothing
  }
  return { tabs: nextTabs, activeId: nextActive }
}
