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
import {
  clampSidebarSplit, dragSidebarSplit, loadSidebarSplit, saveSidebarSplit,
  SIDEBAR_SPLIT_DEFAULT, SIDEBAR_SPLIT_MIN, SIDEBAR_SPLIT_MAX
} from '../lib/shell-prefs'

/** The connection sidebar: Connections above the per-connection Explorer, right-edge
 *  drag to resize; collapsed (⌘B) it becomes a narrow column of badges. While the
 *  dashboard shows (or there are no tabs) the Connections zone hides — the dashboard
 *  already lists them. Resize mirrors the right dock: DOM write during drag, commit on release. */
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

  // The line between the two zones: drag it to change how much of the sidebar the
  // connection list may take before it scrolls. Same DOM-write-then-commit as the width.
  const [split, setSplit] = useState(() => loadSidebarSplit())
  const splitRef = useRef(split)
  function commitSplit(f: number): void {
    const next = clampSidebarSplit(f)
    splitRef.current = next
    setSplit(next)
    saveSidebarSplit(next)
  }
  function splitAt(clientY: number): number | null {
    if (!panelRef.current) return null
    const r = panelRef.current.getBoundingClientRect()
    return dragSidebarSplit(clientY, r.top, r.height)
  }
  function onSplitPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const f = splitAt(e.clientY)
    if (f !== null) panelRef.current!.style.setProperty('--sidebar-split', `${f * 100}%`)
  }
  function onSplitPointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const f = splitAt(e.clientY)
    if (f !== null) commitSplit(f)
  }
  function onSplitKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const step = e.key === 'ArrowDown' ? 0.04 : e.key === 'ArrowUp' ? -0.04 : null
    if (step === null) return
    e.preventDefault()
    commitSplit(splitRef.current + step)
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
    <aside className="sidebar" ref={panelRef} 
      style={{ width, '--sidebar-split': `${split * 100}%` } as React.CSSProperties}
      aria-label="Sidebar"
    >
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
      {!hideConnections && (
        <div
          className="sidebar-split"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize connection list"
          aria-valuemin={Math.round(SIDEBAR_SPLIT_MIN * 100)}
          aria-valuemax={Math.round(SIDEBAR_SPLIT_MAX * 100)}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          title="Drag to resize · double-click to reset · ↑/↓ to adjust"
          onPointerDown={onResizePointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={onSplitPointerEnd}
          onPointerCancel={onSplitPointerEnd}
          onDoubleClick={() => commitSplit(SIDEBAR_SPLIT_DEFAULT)}
          onKeyDown={onSplitKeyDown}
        />
      )}
      {/* Same slot either way, so toggling the dashboard never remounts the tree (filter, expansion). */}
      <SidebarExplorer headerEnd={hideConnections ? <>{home}{collapse}</> : undefined} />
    </aside>
  )
}
