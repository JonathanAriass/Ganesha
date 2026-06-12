/** Editor/results split for query tabs: the fraction of the tab's full height
 *  given to the editor pane (flex-basis % resolves against the whole .querytab,
 *  toolbar included — same semantics the old fixed `flex: 0 0 42%` had).
 *  Pure math + storage seam here; QueryTab owns the DOM. localStorage is the
 *  source of truth (a pure UI preference — unlike the theme hint there is no
 *  sqlite setting behind it), one global value shared by every tab: remounting
 *  a tab picks up whatever the last drag anywhere saved. */

const KEY = 'editor-split'

export const DEFAULT_EDITOR_FRACTION = 0.3
export const MIN_EDITOR_FRACTION = 0.12
export const MAX_EDITOR_FRACTION = 0.85

/** Garbage (NaN/±Infinity) heals to the default; finite values clamp into range. */
export function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_EDITOR_FRACTION
  return Math.min(MAX_EDITOR_FRACTION, Math.max(MIN_EDITOR_FRACTION, f))
}

/** Where a drag at clientY puts the divider. The editor pane's TOP edge never
 *  moves during a drag, so the desired editor height is the pointer's offset
 *  into the pane — divided by the container's full height because that is what
 *  flex-basis percentages resolve against. */
export function dragFraction(clientY: number, paneTop: number, containerHeight: number): number {
  if (containerHeight <= 0) return DEFAULT_EDITOR_FRACTION
  return clampFraction((clientY - paneTop) / containerHeight)
}

/** Storage is injectable for tests (vitest runs in Node — no global localStorage);
 *  the default argument only evaluates when omitted, i.e. in the real renderer. */
export function loadEditorFraction(storage: Pick<Storage, 'getItem'> = localStorage): number {
  const raw = storage.getItem(KEY)
  if (raw === null) return DEFAULT_EDITOR_FRACTION
  return clampFraction(Number(raw))
}

export function saveEditorFraction(
  f: number,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  storage.setItem(KEY, String(clampFraction(f)))
}
