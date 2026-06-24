import { type PaneId, normalizePanes } from './panes'

export interface TabMove {
  tabId: string
  /** The pane the tab is dropped into. */
  toPane: PaneId
  /** Insert the tab before this one; null/absent → append (last in that pane's strip). */
  beforeId: string | null
}

/** Relocate `tabId` to `toPane` at the drop position, then enforce the pane invariants and
 *  report each pane's active tab + focus. The moved tab becomes active in its final pane; a
 *  move that empties a side collapses/re-homes exactly like `applyPaneClose`. Returns the
 *  inputs UNCHANGED (same refs) when the id is unknown, `beforeId === tabId`, or the order is
 *  unchanged — the store short-circuits on `tabs === prev`. Mirrors `applyPaneClose`'s return
 *  shape: the store derives `activeConnByPane` from the returned active tab ids. */
export function applyTabReorder<T extends { id: string; connectionId: string; pane: PaneId }>(
  tabs: T[],
  activeByPane: Record<PaneId, string | null>,
  focusedPane: PaneId,
  move: TabMove
): { tabs: T[]; activeByPane: Record<PaneId, string | null>; focusedPane: PaneId } {
  const { tabId, toPane, beforeId } = move
  const unchanged = { tabs, activeByPane, focusedPane }
  if (beforeId === tabId) return unchanged
  const src = tabs.find((t) => t.id === tabId)
  if (!src) return unchanged

  const without = tabs.filter((t) => t.id !== tabId)
  const moved = { ...src, pane: toPane }
  const beforeIdx = beforeId !== null ? without.findIndex((t) => t.id === beforeId) : -1
  const next =
    beforeIdx >= 0
      ? [...without.slice(0, beforeIdx), moved, ...without.slice(beforeIdx)]
      : [...without, moved]

  // Same (id, pane) sequence → nothing actually moved (e.g. dropped back in place).
  if (next.length === tabs.length && next.every((t, i) => t.id === tabs[i].id && t.pane === tabs[i].pane)) {
    return unchanged
  }

  const norm = normalizePanes(next)
  const movedPane = norm.tabs.find((t) => t.id === tabId)!.pane

  // Each pane's active: the moved tab is active in its final pane; the other pane keeps its
  // active if it still lives there, else its first tab, else null.
  const activeFor = (p: PaneId): string | null => {
    if (p === movedPane) return tabId
    const cur = activeByPane[p]
    const inPane = norm.tabs.filter((t) => t.pane === p)
    if (cur && inPane.some((t) => t.id === cur)) return cur
    return inPane[0]?.id ?? null
  }

  return {
    tabs: norm.tabs,
    activeByPane: { left: activeFor('left'), right: norm.hasRight ? activeFor('right') : null },
    focusedPane: norm.hasRight ? movedPane : 'left', // a collapse always lands on left
  }
}
