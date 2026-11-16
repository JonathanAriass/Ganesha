import { useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { mod } from '../lib/platform'
import SidebarConnections from './SidebarConnections'
import SidebarExplorer from './SidebarExplorer'
import SidebarBadges from './SidebarBadges'
import { Icon } from './icons'
import {
  clampSideWidth, dragSideWidth, loadSideWidth, saveSideWidth,
  SIDE_DEFAULT_WIDTH, SIDE_MIN_WIDTH, SIDE_MAX_WIDTH
} from '../lib/side-panel'

/** The connection sidebar: Connections above the per-connection Explorer, right-edge
 *  drag to resize; collapsed (⌘B) it becomes a narrow column of badges. While the
 *  dashboard shows (or there are no tabs) the Connections zone hides — the dashboard
 *  already lists them. Resize mirrors AssistantPanel: DOM write during drag, commit on release. */
export default function Sidebar(): JSX.Element {
  const open = useAppStore((s) => s.sideOpen)
  const toggleSide = useAppStore((s) => s.toggleSide)
  const dashboardOpen = useAppStore((s) => s.dashboardOpen)
  const toggleDashboard = useAppStore((s) => s.toggleDashboard)
  const hideConnections = useAppStore((s) => s.tabs.length === 0 || s.dashboardOpen)

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

  if (!open) return <SidebarBadges />

  // The sidebar header's Home and Collapse: shown in the Connections zone, or in the
  // Explorer header while that zone is hidden, so both stay reachable.
  const home = (
    <button
      className={`icon-btn${dashboardOpen ? ' active' : ''}`}
      onClick={toggleDashboard}
      aria-label="Connections dashboard"
      aria-pressed={dashboardOpen}
      data-tooltip="Connections dashboard"
      data-tip="right"
    >
      <Icon name="home" />
    </button>
  )
  const collapse = (
    <button
      className="icon-btn"
      onClick={toggleSide}
      aria-label="Collapse sidebar"
      data-tooltip={`Collapse sidebar (${mod}B)`}
      data-tip="right"
    >
      <Icon name="sidebar" />
    </button>
  )

  return (
    <aside className="sidebar" ref={panelRef} style={{ width }} aria-label="Sidebar">
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
      {!hideConnections && <SidebarConnections home={home} collapse={collapse} />}
      {/* Same slot either way, so toggling the dashboard never remounts the tree (filter, expansion). */}
      <SidebarExplorer headerEnd={hideConnections ? <>{home}{collapse}</> : undefined} />
    </aside>
  )
}
