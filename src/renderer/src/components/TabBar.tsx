import { useState, type DragEvent } from 'react'
import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { visibleTabs, showScopeSwitch, effectiveTabScope } from '../lib/tab-groups'
import { Icon } from './icons'
import TabContextMenu, { type TabCloseAction } from './TabContextMenu'
import { type PaneId, paneTabs } from '../lib/panes'
import { TAB_MIME } from '../lib/tab-reorder'

export default function TabBar({ pane }: { pane: PaneId }): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabByPane[pane])
  const activeConnectionId = useAppStore((s) => s.activeConnByPane[pane])
  const focusPane = useAppStore((s) => s.focusPane)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const tabScope = useAppStore((s) => s.tabScope)
  const setTabScope = useAppStore((s) => s.setTabScope)
  const renameTab = useAppStore((s) => s.renameTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs)
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight)
  const closeTabsToLeft = useAppStore((s) => s.closeTabsToLeft)
  const closeAllTabs = useAppStore((s) => s.closeAllTabs)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const splitActiveTab = useAppStore((s) => s.splitActiveTab)
  const moveTabToOtherPane = useAppStore((s) => s.moveTabToOtherPane)
  const reorderTab = useAppStore((s) => s.reorderTab)
  const setTabDragging = useAppStore((s) => s.setTabDragging)

  // Inline rename: double-click a tab to edit its title. Enter/click-away commits, Escape cancels.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  // Drag-and-drop: `drag` is the tab being dragged from THIS strip (dims it); `drop` marks where a
  // drop would land in THIS strip (null = not over it; `beforeId` null = at the end of the strip).
  const [drag, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ beforeId: string | null } | null>(null)

  // The drop position is computed centrally from the pointer-x vs each tab's midpoint, so a drop
  // on empty strip space (or the other pane) is handled by one place. The other pane's TabBar is
  // its own drop target reading the same dataTransfer id, so cross-pane drag needs no shared state.
  function onStripDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    let beforeId: string | null = null
    for (const el of e.currentTarget.querySelectorAll<HTMLElement>('[data-tab-id]')) {
      if (el.dataset.tabId === drag) continue // never indicate a drop before the dragged tab itself
      const r = el.getBoundingClientRect()
      if (e.clientX < r.left + r.width / 2) {
        beforeId = el.dataset.tabId ?? null
        break
      }
    }
    setDrop({ beforeId })
  }

  function onStripDrop(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    const id = e.dataTransfer.getData(TAB_MIME)
    const beforeId = drop?.beforeId ?? null
    setDrop(null)
    setDrag(null)
    if (id) reorderTab({ tabId: id, toPane: pane, beforeId })
  }

  // dragleave fires when crossing into a child too — only clear when truly leaving the strip.
  function onStripDragLeave(e: DragEvent<HTMLDivElement>): void {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
  }

  const commit = (): void => {
    if (editing) renameTab(editing.id, editing.draft)
    setEditing(null)
  }

  // Menu actions close within the tabs the strip is showing (scope handled by the store).
  const runMenu = (action: TabCloseAction): void => {
    if (!menu) return
    const id = menu.tabId
    if (action === 'move-pane') moveTabToOtherPane(id)
    else if (action === 'close') closeTab(id)
    else if (action === 'others') closeOtherTabs(id)
    else if (action === 'right') closeTabsToRight(id)
    else if (action === 'left') closeTabsToLeft(id)
    else closeAllTabs(id)
  }

  const { data: connections = [] } = useConnections()

  // One strip: every tab of the pane, or only the pane's active connection's, per the scope
  // switch (all tabs whenever the switch is hidden).
  const paneAllTabs = paneTabs(tabs, pane)
  const subtabs = visibleTabs(paneAllTabs, effectiveTabScope(paneAllTabs, tabScope), activeConnectionId ?? null)
  const menuIdx = menu ? subtabs.findIndex((t) => t.id === menu.tabId) : -1

  return (
    <div className="tabbar-wrap">
      <div
        className="tabbar"
        role="tablist"
        onDragOver={onStripDragOver}
        onDrop={onStripDrop}
        onDragLeave={onStripDragLeave}
      >
        {subtabs.map((tab) => {
          const conn = connections.find((c) => c.id === tab.connectionId)
          const dot = conn && (
            <span
              className="conn-dot"
              style={{ background: conn.color, width: 8, height: 8 }}
              aria-hidden="true"
            />
          )
          if (editing?.id === tab.id) {
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeTabId}
                className={`tab${tab.id === activeTabId ? ' active' : ''}`}
              >
                {dot}
                <input
                  className="tab-rename"
                  value={editing.draft}
                  aria-label="Rename tab"
                  autoFocus
                  style={{ width: `${Math.max(editing.draft.length, 6)}ch` }}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEditing({ id: tab.id, draft: e.target.value })}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter') commit()
                    else if (e.key === 'Escape') setEditing(null)
                  }}
                />
              </div>
            )
          }
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              data-tab-id={tab.id}
              draggable
              className={`tab${tab.id === activeTabId ? ' active' : ''}${tab.id === drag ? ' dragging' : ''}${drop?.beforeId === tab.id ? ' drop-before' : ''}`}
              title="Double-click to rename · drag to reorder or move to the other pane"
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, tab.id)
                e.dataTransfer.effectAllowed = 'move'
                setDrag(tab.id)
                setTabDragging(true) // arms the editor-body drop overlay in every pane
              }}
              onDragEnd={() => {
                setDrag(null)
                setDrop(null)
                setTabDragging(false)
              }}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => setEditing({ id: tab.id, draft: tab.title })}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
              }}
            >
              {dot}
              <span>{tab.title}</span>
              <span
                className="tab-close"
                role="button"
                aria-label={`Close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <Icon name="close" size={12} />
              </span>
            </button>
          )
        })}
        <button
          className={`tab-add btn ghost${drop !== null && drop.beforeId === null ? ' drop-before' : ''}`}
          aria-label="New query tab"
          disabled={!activeConnectionId}
          title={activeConnectionId ? 'New query tab' : 'Connect first'}
          onClick={() => { focusPane(pane); if (activeConnectionId) openQueryTab({ connectionId: activeConnectionId }) }}
        >
          <Icon name="plus" size={14} />
        </button>
        {showScopeSwitch(paneAllTabs) && (
          <div className="tab-scope" role="group" aria-label="Tab scope">
            {(['all', 'connection'] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                className="tab-scope-btn"
                aria-pressed={tabScope === sc}
                onClick={() => setTabScope(sc)}
              >
                {sc === 'all' ? 'All tabs' : 'This connection'}
              </button>
            ))}
          </div>
        )}
        <button
          className="tab-split btn ghost"
          aria-label="Split — open this tab on the other side"
          title="Open this tab on the other side"
          disabled={!activeTabId}
          onClick={() => { focusPane(pane); splitActiveTab() }}
        >
          ⊟
        </button>
        {menu && (
          <TabContextMenu
            x={menu.x}
            y={menu.y}
            canRight={menuIdx >= 0 && menuIdx < subtabs.length - 1}
            canLeft={menuIdx > 0}
            onSelect={runMenu}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </div>
  )
}
