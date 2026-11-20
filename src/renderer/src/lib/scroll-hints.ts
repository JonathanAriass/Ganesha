/** Scroll arrows: instead of a scrollbar, a scrolling area shows an arrow on each side that
 *  has content out of view. These are the pure parts, shared by every such area. */

/** One axis of a scrolling area: where it is, how much there is, how much is visible. */
export interface ScrollAxis { pos: number; size: number; client: number }

/** Which ends of an axis have content out of view. A pixel of slack absorbs fractional
 *  scroll positions, so an arrow never lingers at either end. */
export function overflowEnds({ pos, size, client }: ScrollAxis): { start: boolean; end: boolean } {
  return { start: pos > 1, end: pos + client < size - 1 }
}

/** How far one click on an arrow scrolls: most of what is visible, so whatever is cut at
 *  the edge is still on screen after the jump. */
export function scrollStep(client: number): number {
  return Math.max(120, Math.round(client * 0.8))
}
