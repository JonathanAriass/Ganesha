/** Results-grid column sizing. Columns default to a flexible fill (`minmax(140px, 1fr)`);
 *  once a user drags or auto-fits one it locks to a pixel width. Pure helpers — the drag
 *  wiring and canvas text measuring live in the component. */

export const MIN_COL_WIDTH = 64
export const MAX_COL_WIDTH = 600
export const DEFAULT_COL_WIDTH = 140

/** Clamp a candidate pixel width into the allowed range (and round to a whole pixel). */
export function clampColumnWidth(px: number): number {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(px)))
}

/** `grid-template-columns`: a fixed `<n>px` for each resized column, `minmax(140px, 1fr)`
 *  (the flexible fill) for every column the user hasn't touched. */
export function buildGridTemplate(count: number, widths: Record<number, number>): string {
  const cols: string[] = []
  for (let i = 0; i < count; i++) {
    const w = widths[i]
    cols.push(w != null ? `${w}px` : `minmax(${DEFAULT_COL_WIDTH}px, 1fr)`)
  }
  return cols.join(' ')
}

/** Min width for the horizontal-scroll floor: resized columns contribute their px width,
 *  untouched columns the default. */
export function gridMinWidth(count: number, widths: Record<number, number>): number {
  let sum = 0
  for (let i = 0; i < count; i++) sum += widths[i] ?? DEFAULT_COL_WIDTH
  return sum
}

/** Auto-fit width: the widest of the header label and the given cell texts (measured by the
 *  injected `measure`), plus horizontal padding, clamped to the allowed range. */
export function autoFitWidth(
  headerText: string,
  cellTexts: string[],
  measure: (s: string) => number,
  padding = 24,
): number {
  let max = measure(headerText)
  for (const t of cellTexts) {
    const w = measure(t)
    if (w > max) max = w
  }
  return clampColumnWidth(max + padding)
}
