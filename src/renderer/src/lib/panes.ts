import { applyTabClose, type CloseMode } from './tab-close'

/** Which side of a split a tab lives in. A string (not a union of more) only by
 *  YAGNI — widening to more panes later needs no structural change here. */
export type PaneId = 'left' | 'right'

export function otherPane(p: PaneId): PaneId {
  return p === 'left' ? 'right' : 'left'
}

/** A pane's tabs, display order preserved. */
export function paneTabs<T extends { pane: PaneId }>(tabs: T[], p: PaneId): T[] {
  return tabs.filter((t) => t.pane === p)
}

/** The tab to activate in `pane` after `removedId` leaves it: the nearest surviving
 *  tab in that pane (the one after the removed index, else the one before), else null. */
export function nextActiveInPane<T extends { id: string; pane: PaneId }>(
  tabs: T[],
  pane: PaneId,
  removedId: string
): string | null {
  const group = tabs.filter((t) => t.pane === pane)
  const idx = group.findIndex((t) => t.id === removedId)
  const survivors = group.filter((t) => t.id !== removedId)
  if (survivors.length === 0) return null
  if (idx === -1) return survivors[0].id
  const after = group.slice(idx + 1).find((t) => t.id !== removedId)
  const before = group.slice(0, idx).reverse().find((t) => t.id !== removedId)
  return (after ?? before ?? survivors[0]).id
}

/** Enforce the pane invariants: if there are right tabs but no left tabs, rewrite every
 *  tab to `left` (collapse the split). Returns the (possibly rewritten) tabs plus which
 *  panes are non-empty. Pure — knows nothing about active tabs or focus. */
export function normalizePanes<T extends { pane: PaneId }>(
  tabs: T[]
): { tabs: T[]; hasLeft: boolean; hasRight: boolean } {
  const hasLeft = tabs.some((t) => t.pane === 'left')
  const hasRight = tabs.some((t) => t.pane === 'right')
  if (hasRight && !hasLeft) {
    return { tabs: tabs.map((t) => ({ ...t, pane: 'left' as PaneId })), hasLeft: true, hasRight: false }
  }
  return { tabs, hasLeft, hasRight }
}

/** Close tab(s) scoped to the TARGET tab's pane + connection group, then keep the pane
 *  invariants and reselect each pane's active tab.
 *  - The close MODE (`self`/`others`/`right`/`left`/`all`) acts within the visible subtab
 *    set of the target's pane (same pane AND same connection) — exactly what the user sees.
 *  - The OTHER pane is never touched (its active tab stays put), unless a re-home collapses
 *    the split.
 *  - Reselection in the closed pane: keep its active tab if it survived; else the nearest
 *    survivor in the closed group; else the first remaining tab anywhere in that pane; else
 *    null.
 *  - Focus moves to the surviving pane only if the closed pane emptied; a collapse always
 *    lands on `left`. */
export function applyPaneClose<T extends { id: string; connectionId: string; pane: PaneId }>(
  tabs: T[],
  activeByPane: Record<PaneId, string | null>,
  focusedPane: PaneId,
  mode: CloseMode,
  targetId: string
): { tabs: T[]; activeByPane: Record<PaneId, string | null>; focusedPane: PaneId } {
  const target = tabs.find((t) => t.id === targetId)
  if (!target) return { tabs, activeByPane, focusedPane } // unknown target → no-op
  const tp = target.pane
  const conn = target.connectionId

  // Scope = the target pane's visible subtabs (pane + connection), in order.
  const scope = tabs.filter((t) => t.pane === tp && t.connectionId === conn)
  const kept = applyTabClose(scope, activeByPane[tp], mode, targetId).tabs
  const keptIds = new Set(kept.map((t) => t.id))
  const nextTabs = tabs.filter((t) => !(t.pane === tp && t.connectionId === conn) || keptIds.has(t.id))

  // Reselect the closed pane's active tab.
  const tpTabs = nextTabs.filter((t) => t.pane === tp)
  let tpActive: string | null
  if (activeByPane[tp] && tpTabs.some((t) => t.id === activeByPane[tp])) {
    tpActive = activeByPane[tp] // the active tab wasn't among those closed
  } else {
    // nearest survivor in the closed group, else first remaining tab in the pane.
    // Keyed off keptIds (not a single removed id) so bulk modes (others/all/right/left)
    // are handled too — which is why this can't reuse nextActiveInPane (single-id removal).
    const gIdx = scope.findIndex((t) => t.id === targetId)
    const after = scope.slice(gIdx + 1).find((t) => keptIds.has(t.id))
    const before = scope.slice(0, gIdx).reverse().find((t) => keptIds.has(t.id))
    tpActive = (after ?? before)?.id ?? tpTabs[0]?.id ?? null
  }

  const nextActive: Record<PaneId, string | null> = { ...activeByPane, [tp]: tpActive }

  // Keep the invariants. Re-home (right→left with empty left) collapses to one pane.
  const norm = normalizePanes(nextTabs)
  if (!norm.hasRight) {
    // Single left pane: if we re-homed, the survivors were the former RIGHT tabs, so the
    // left active becomes the former right active; otherwise it's the recomputed left active.
    const reHomed = nextTabs.some((t) => t.pane === 'right')
    const leftActive = reHomed ? nextActive.right : nextActive.left
    return { tabs: norm.tabs, activeByPane: { left: leftActive, right: null }, focusedPane: 'left' }
  }

  // Still split: focus follows only if the closed pane emptied (it can only be the non-`tp`
  // pane that survives here, since an empty left would have re-homed above).
  const tpEmpty = !norm.tabs.some((t) => t.pane === tp)
  return { tabs: norm.tabs, activeByPane: nextActive, focusedPane: tpEmpty ? otherPane(tp) : focusedPane }
}
