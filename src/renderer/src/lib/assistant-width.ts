/** Width (px) of the dockable assistant panel. A fixed px width (not a fraction)
 *  keeps a side panel sane across window sizes. localStorage is the source of
 *  truth — a pure UI preference, same precedent as the editor split. */

const KEY = 'assistant-width'

export const DEFAULT_WIDTH = 420
export const MIN_WIDTH = 320
export const MAX_WIDTH = 900

/** Garbage (NaN/±Infinity) heals to the default; finite values clamp into range
 *  and round to a whole pixel (getBoundingClientRect can hand back sub-pixel floats). */
export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_WIDTH
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)))
}

/** The panel is docked at the right, so its width is the distance from the
 *  pointer to the panel's right edge (which doesn't move during a drag). */
export function dragWidth(clientX: number, panelRight: number): number {
  return clampWidth(panelRight - clientX)
}

export function loadWidth(storage: Pick<Storage, 'getItem'> = localStorage): number {
  const raw = storage.getItem(KEY)
  if (raw === null) return DEFAULT_WIDTH
  return clampWidth(Number(raw))
}

export function saveWidth(w: number, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(KEY, String(clampWidth(w)))
}
