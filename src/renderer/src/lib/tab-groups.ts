/** Query tabs grouped by the connection (server) they belong to. Groups are a derived view over
 *  the flat tabs array — there is no parallel data structure. Pure helpers; the store wraps them. */

import type { TabScope } from './shell-prefs'

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

/** Tabs the strip shows: every tab, or only the active connection's. */
export function visibleTabs<T extends { connectionId: string }>(
  paneTabs: T[],
  scope: TabScope,
  activeConnectionId: string | null
): T[] {
  if (scope === 'all') return paneTabs
  if (activeConnectionId == null) return []
  return paneTabs.filter((t) => t.connectionId === activeConnectionId)
}

/** The scope switch only matters when the pane holds tabs from 2+ connections. */
export function showScopeSwitch(paneTabs: { connectionId: string }[]): boolean {
  return new Set(paneTabs.map((t) => t.connectionId)).size > 1
}

/** The scope the strip applies: the chosen one while its switch shows, else 'all' — a hidden
 *  switch must never leave the strip filtered (it could empty it with no way back). */
export function effectiveTabScope(paneTabs: { connectionId: string }[], scope: TabScope): TabScope {
  return showScopeSwitch(paneTabs) ? scope : 'all'
}
