import { useRef, useState } from 'react'
import {
  clampPaneFraction,
  dragPaneFraction,
  loadPaneFraction,
  savePaneFraction,
  DEFAULT_PANE_FRACTION,
  MIN_PANE_FRACTION,
  MAX_PANE_FRACTION,
} from '../lib/pane-split'

/** Vertical drag-to-resize between the two editor panes. The left pane gets `fraction` of the
 *  container width as flex-basis; the parent `.panes` is the positioning context. Direct DOM
 *  writes during the drag (no React re-render per pointermove — the grids under both panes
 *  would re-render); React state + localStorage commit on pointerup. */
export default function PaneDivider({ leftPaneRef }: { leftPaneRef: React.RefObject<HTMLDivElement> }): JSX.Element {
  const [fraction, setFraction] = useState(() => loadPaneFraction())
  const dragRef = useRef(fraction)

  function commit(f: number): void {
    dragRef.current = f
    setFraction(f)
    savePaneFraction(f)
    const pane = leftPaneRef.current
    if (pane) pane.style.flexBasis = `${f * 100}%`
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const pane = leftPaneRef.current
    const container = pane?.parentElement
    if (!pane || !container) return
    const rect = container.getBoundingClientRect()
    const f = dragPaneFraction(e.clientX, rect.left, rect.width)
    dragRef.current = f
    pane.style.flexBasis = `${f * 100}%`
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    commit(dragRef.current)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : null
    if (step === null) return
    e.preventDefault()
    commit(clampPaneFraction(dragRef.current + step))
  }

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the two panes"
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round(MAX_PANE_FRACTION * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => commit(DEFAULT_PANE_FRACTION)}
      onKeyDown={onKeyDown}
    />
  )
}
