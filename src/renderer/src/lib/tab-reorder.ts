import { type PaneId, otherPane, normalizePanes } from './panes'

/** dataTransfer key carrying the dragged tab's id (readable only on drop, by any pane). */
export const TAB_MIME = 'application/x-ganesha-tab'

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

/** Drag a tab onto the editor body to split: put `tabId` on `side` and EVERY OTHER tab on the
 *  opposite side, then enforce the invariants (so a single tab can't split — it re-homes left)
 *  and focus the dragged tab. The other pane keeps the previously-focused tab if it landed
 *  there, else its first tab. Returns the inputs unchanged (same refs) when the id is unknown
 *  or no pane actually changes. Same return shape as `applyTabReorder`. */
export function applyTabToSide<T extends { id: string; connectionId: string; pane: PaneId }>(
  tabs: T[],
  activeByPane: Record<PaneId, string | null>,
  focusedPane: PaneId,
  arg: { tabId: string; side: PaneId }
): { tabs: T[]; activeByPane: Record<PaneId, string | null>; focusedPane: PaneId } {
  const { tabId, side } = arg
  const unchanged = { tabs, activeByPane, focusedPane }
  if (!tabs.some((t) => t.id === tabId)) return unchanged
  const other = otherPane(side)
  const next = tabs.map((t) => ({ ...t, pane: t.id === tabId ? side : other }))
  if (next.every((t, i) => t.pane === tabs[i].pane)) return unchanged // nothing moved

  const norm = normalizePanes(next)
  const movedPane = norm.tabs.find((t) => t.id === tabId)!.pane

  const activeFor = (p: PaneId): string | null => {
    if (p === movedPane) return tabId
    const inPane = norm.tabs.filter((t) => t.pane === p)
    const prev = activeByPane[focusedPane] // the tab that was active before the split
    if (prev && prev !== tabId && inPane.some((t) => t.id === prev)) return prev
    return inPane[0]?.id ?? null
  }

  return {
    tabs: norm.tabs,
    activeByPane: { left: activeFor('left'), right: norm.hasRight ? activeFor('right') : null },
    focusedPane: norm.hasRight ? movedPane : 'left',
  }
}
