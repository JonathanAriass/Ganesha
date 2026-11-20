import { useEffect, useRef, useState } from 'react'
import { overflowEnds, scrollStep, type ScrollAxis } from '../lib/scroll-hints'
import { Icon } from './icons'

/** Something that scrolls and can say so: a DOM element, or the code editor (which scrolls
 *  on its own, not natively). */
export interface ScrollSource {
  read(): { x: ScrollAxis; y: ScrollAxis }
  scrollBy(dx: number, dy: number): void
  /** Call `cb` whenever position or sizes may have changed; returns the unsubscribe. */
  subscribe(cb: () => void): () => void
}

/** The source for a native scroller: scroll events, its own resizes, and content changes. */
export function elementSource(el: HTMLElement): ScrollSource {
  return {
    read: () => ({
      x: { pos: el.scrollLeft, size: el.scrollWidth, client: el.clientWidth },
      y: { pos: el.scrollTop, size: el.scrollHeight, client: el.clientHeight }
    }),
    scrollBy: (dx, dy) => el.scrollBy({ left: dx, top: dy, behavior: 'smooth' }),
    subscribe: (cb) => {
      el.addEventListener('scroll', cb, { passive: true })
      const ro = new ResizeObserver(cb)
      ro.observe(el)
      const mo = new MutationObserver(cb)
      mo.observe(el, { childList: true, subtree: true })
      return () => { el.removeEventListener('scroll', cb); ro.disconnect(); mo.disconnect() }
    }
  }
}

type Box = { left: number; top: number; width: number; height: number }
type State = { up: boolean; down: boolean; left: boolean; right: boolean; box: Box | null }
const NONE: State = { up: false, down: false, left: false, right: false, box: null }

/** Arrows in place of a scrollbar: one on each side of the area that has more out of view,
 *  each scrolling that way when clicked. Render it inside a positioned ancestor of the area.
 *  `target` is a selector for the scroller under that ancestor (the arrows hug its box, minus
 *  `insetTop`'s height for a sticky header); `source` is for areas that are not DOM scrollers
 *  and fills the ancestor. */
export default function ScrollArrows({ target, source, axis = 'y', insetTop }: {
  target?: string
  source?: ScrollSource | null
  axis?: 'x' | 'y' | 'both'
  insetTop?: string
}): JSX.Element | null {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const sourceRef = useRef<ScrollSource | null>(null)
  const [state, setState] = useState<State>(NONE)

  useEffect(() => {
    const parent = anchorRef.current?.parentElement
    const el = target ? parent?.querySelector<HTMLElement>(target) ?? null : null
    const src = source ?? (el ? elementSource(el) : null)
    sourceRef.current = src
    if (!src || !parent) { setState(NONE); return }
    let frame = 0
    const measure = (): void => {
      frame = 0
      const { x, y } = src.read()
      const h = axis === 'y' ? { start: false, end: false } : overflowEnds(x)
      const v = axis === 'x' ? { start: false, end: false } : overflowEnds(y)
      let box: Box | null = null
      if (el) {
        const a = el.getBoundingClientRect()
        const b = parent.getBoundingClientRect()
        const head = insetTop ? el.querySelector<HTMLElement>(insetTop)?.offsetHeight ?? 0 : 0
        box = { left: a.left - b.left, top: a.top - b.top + head, width: a.width, height: a.height - head }
      }
      setState((p) =>
        p.up === v.start && p.down === v.end && p.left === h.start && p.right === h.end &&
        p.box?.left === box?.left && p.box?.top === box?.top && p.box?.width === box?.width && p.box?.height === box?.height
          ? p
          : { up: v.start, down: v.end, left: h.start, right: h.end, box })
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(measure) }
    const stop = src.subscribe(schedule)
    measure()
    return () => { stop(); if (frame) cancelAnimationFrame(frame) }
  }, [target, source, axis, insetTop])

  function go(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    const src = sourceRef.current
    if (!src) return
    const { x, y } = src.read()
    src.scrollBy(dx * scrollStep(x.client), dy * scrollStep(y.client))
  }

  const style = state.box ?? { left: 0, top: 0, width: '100%', height: '100%' }
  return (
    <>
      <span ref={anchorRef} hidden />
      {(state.up || state.down || state.left || state.right) && (
        <div className="scroll-arrows" style={style}>
          {state.up && (
            <div className="scroll-arrow scroll-arrow-up">
              <button onClick={() => go(0, -1)} aria-label="Scroll up" tabIndex={-1}><Icon name="chevron-up" /></button>
            </div>
          )}
          {state.down && (
            <div className="scroll-arrow scroll-arrow-down">
              <button onClick={() => go(0, 1)} aria-label="Scroll down" tabIndex={-1}><Icon name="chevron-down" /></button>
            </div>
          )}
          {state.left && (
            <div className="scroll-arrow scroll-arrow-left">
              <button onClick={() => go(-1, 0)} aria-label="Scroll left" tabIndex={-1}><Icon name="chevron-left" /></button>
            </div>
          )}
          {state.right && (
            <div className="scroll-arrow scroll-arrow-right">
              <button onClick={() => go(1, 0)} aria-label="Scroll right" tabIndex={-1}><Icon name="chevron-right" /></button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
