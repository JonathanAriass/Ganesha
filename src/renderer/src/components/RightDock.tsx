import { useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { clampWidth, dragWidth, loadWidth, saveWidth, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH } from '../lib/assistant-width'
import { Icon } from './icons'
import AssistantPanel from './AssistantPanel'
import SsmPanel from './SsmPanel'

/** One dock at the right of the app body holding the assistant and the SSM tunnels panel; it
 *  opens from the status bar. Both
 *  panels stay mounted always (the aside is `hidden` when the dock is closed, and the inactive
 *  panel is `hidden` when it is open) so SSM output keeps
 *  buffering and an assistant generation keeps streaming while the other tab is showing. */
export default function RightDock(): JSX.Element {
  const dock = useAppStore((s) => s.dock)
  const toggleAssistant = useAppStore((s) => s.toggleAssistant)
  const toggleSsm = useAppStore((s) => s.toggleSsm)
  const closeDock = useAppStore((s) => s.closeDock)

  // Closing hides the aside, so focus (on the close button) would drop to <body>: hand it to
  // the status-bar button that opens the panel just closed.
  function close(): void {
    const opener = dock === 'tunnels' ? 'tunnels' : 'assistant'
    closeDock()
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dock-toggle="${opener}"]`)?.focus())
  }

  // ── Horizontal resize (drag the left edge) ──
  const panelRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(() => loadWidth())
  const widthRef = useRef(width) // leads every commit so same-tick key repeats accumulate
  function commitWidth(w: number): void {
    widthRef.current = w
    setWidth(w)
    saveWidth(w)
  }
  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    // Direct DOM write during the drag; commit to state + localStorage on pointerup
    // (a re-render per move would re-render the streaming thread).
    panelRef.current.style.width = `${dragWidth(e.clientX, panelRef.current.getBoundingClientRect().right)}px`
  }
  function onResizePointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    commitWidth(clampWidth(panelRef.current.getBoundingClientRect().width))
  }
  function onResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    // Left edge of a right-docked panel: ArrowLeft widens, ArrowRight narrows.
    const step = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : null
    if (step === null) return
    e.preventDefault()
    commitWidth(clampWidth(widthRef.current + step))
  }

  return (
    <>
      <aside className="right-dock" ref={panelRef} style={{ width }} aria-label="Side panel" hidden={dock === null}>
        <div
          className="assistant-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          title="Drag to resize · double-click to reset · ←/→ to adjust"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
          onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
          onKeyDown={onResizeKeyDown}
        />
        <div className="dock-head">
          <div className="dock-tabs">
            <button
              className={`dock-tab${dock === 'assistant' ? ' active' : ''}`}
              aria-pressed={dock === 'assistant'}
              onClick={() => { if (dock !== 'assistant') toggleAssistant() }}
            >
              Assistant
            </button>
            <button
              className={`dock-tab${dock === 'tunnels' ? ' active' : ''}`}
              aria-pressed={dock === 'tunnels'}
              onClick={() => { if (dock !== 'tunnels') toggleSsm() }}
            >
              Tunnels
            </button>
          </div>
          <button className="btn ghost xs dock-close" onClick={close} aria-label="Close panel" title="Close panel">
            <Icon name="close" size={14} />
          </button>
        </div>
        <AssistantPanel hidden={dock !== 'assistant'} />
        <SsmPanel hidden={dock !== 'tunnels'} />
      </aside>
    </>
  )
}
