import { useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import ObjectTree from './ObjectTree'
import SavedSection from './SavedSection'
import HistorySection from './HistorySection'
import {
  clampSideWidth, dragSideWidth, loadSideWidth, saveSideWidth,
  SIDE_DEFAULT_WIDTH, SIDE_MIN_WIDTH, SIDE_MAX_WIDTH
} from '../lib/side-panel'

const TITLES = { schema: 'Schema', saved: 'Saved queries', history: 'History' } as const

/** Rail-opened panel: one section at a time, right-edge drag to resize.
 *  Resize mirrors AssistantPanel: DOM write during drag, commit on release. */
export default function SidePanel(): JSX.Element | null {
  const open = useAppStore((s) => s.sideOpen)
  const section = useAppStore((s) => s.sideSection)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)

  const panelRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(() => loadSideWidth())
  const widthRef = useRef(width)
  function commitWidth(w: number): void {
    widthRef.current = w
    setWidth(w)
    saveSideWidth(w)
  }
  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    panelRef.current.style.width = `${dragSideWidth(e.clientX, panelRef.current.getBoundingClientRect().left)}px`
  }
  function onResizePointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    commitWidth(clampSideWidth(panelRef.current.getBoundingClientRect().width))
  }
  function onResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    // Right edge of a LEFT-docked panel: ArrowRight widens, ArrowLeft narrows.
    const step = e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : null
    if (step === null) return
    e.preventDefault()
    commitWidth(clampSideWidth(widthRef.current + step))
  }

  if (!open) return null

  return (
    <aside className="side-panel" ref={panelRef} style={{ width }} aria-label={TITLES[section]}>
      {/* Resizer first (position: absolute → visually unchanged) so keyboard users
          reach it without tabbing through the whole tree; matches AssistantPanel. */}
      <div
        className="side-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        aria-valuemin={SIDE_MIN_WIDTH}
        aria-valuemax={SIDE_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title="Drag to resize · double-click to reset · ←/→ to adjust"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        onPointerCancel={onResizePointerEnd}
        onDoubleClick={() => commitWidth(SIDE_DEFAULT_WIDTH)}
        onKeyDown={onResizeKeyDown}
      />
      <div className="side-head">{TITLES[section]}</div>
      <div className="side-body">
        {section === 'schema' && <ObjectTree />}
        {section === 'saved' &&
          (activeConnectionId ? <SavedSection /> : <div className="sidebar-empty"><p>No connection selected.</p></div>)}
        {section === 'history' &&
          (activeConnectionId ? <HistorySection /> : <div className="sidebar-empty"><p>No connection selected.</p></div>)}
      </div>
    </aside>
  )
}
