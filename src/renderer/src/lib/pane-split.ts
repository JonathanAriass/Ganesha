/** Left/right split for the two editor panes: the fraction of the container width given
 *  to the LEFT pane (flex-basis %). Pure math + storage seam — PaneDivider owns the DOM.
 *  localStorage is the single source of truth (a pure UI preference), one global value. */

const KEY = 'pane-split'

export const DEFAULT_PANE_FRACTION = 0.5
export const MIN_PANE_FRACTION = 0.2
export const MAX_PANE_FRACTION = 0.8

export function clampPaneFraction(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_PANE_FRACTION
  return Math.min(MAX_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, f))
}

/** Where a drag at clientX puts the divider: the pointer's offset into the panes
 *  container, divided by the container width (what flex-basis % resolves against). */
export function dragPaneFraction(clientX: number, containerLeft: number, containerWidth: number): number {
  if (containerWidth <= 0) return DEFAULT_PANE_FRACTION
  return clampPaneFraction((clientX - containerLeft) / containerWidth)
}

export function loadPaneFraction(storage: Pick<Storage, 'getItem'> = localStorage): number {
  const raw = storage.getItem(KEY)
  if (raw === null) return DEFAULT_PANE_FRACTION
  return clampPaneFraction(Number(raw))
}

export function savePaneFraction(f: number, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(KEY, String(clampPaneFraction(f)))
}
