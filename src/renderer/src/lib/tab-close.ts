/** Bulk tab-close operations, scoped to a right-clicked "target" tab. Pure — the store wraps
 *  this and additionally drops a commit modal whose tab no longer survives. */

export type CloseMode = 'others' | 'right' | 'left' | 'all'

/** Compute the surviving tabs and the next active id after a close.
 *  - `all` clears every tab; `others` keeps only the target; `right`/`left` keep the target and
 *    the tabs on that side of it.
 *  - The active tab is preserved if it survives; otherwise it falls back to the target (which
 *    survives in every mode but `all`), then the first remaining tab, then null.
 *  - An unknown target id is a no-op for the targeted modes (`all` ignores the target). */
export function applyTabClose<T extends { id: string }>(
  tabs: T[],
  activeId: string | null,
  mode: CloseMode,
  targetId: string,
): { tabs: T[]; activeId: string | null } {
  const idx = tabs.findIndex((t) => t.id === targetId)
  if (idx === -1 && mode !== 'all') return { tabs, activeId }

  let kept: T[]
  switch (mode) {
    case 'all':
      kept = []
      break
    case 'others':
      kept = tabs.filter((t) => t.id === targetId)
      break
    case 'right':
      kept = tabs.slice(0, idx + 1)
      break
    case 'left':
      kept = tabs.slice(idx)
      break
  }

  const nextActive = kept.some((t) => t.id === activeId)
    ? activeId
    : kept.some((t) => t.id === targetId)
      ? targetId
      : (kept[0]?.id ?? null)
  return { tabs: kept, activeId: nextActive }
}
