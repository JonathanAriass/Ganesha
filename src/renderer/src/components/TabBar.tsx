import { useState } from 'react'
import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { groupTabs } from '../lib/tab-groups'
import TabContextMenu, { type TabCloseAction } from './TabContextMenu'
import { type PaneId, paneTabs } from '../lib/panes'

export default function TabBar({ pane }: { pane: PaneId }): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabByPane[pane])
  const activeConnectionId = useAppStore((s) => s.activeConnByPane[pane])
  const focusPane = useAppStore((s) => s.focusPane)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const renameTab = useAppStore((s) => s.renameTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs)
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight)
  const closeTabsToLeft = useAppStore((s) => s.closeTabsToLeft)
  const closeAllTabs = useAppStore((s) => s.closeAllTabs)
  const openQueryTab = useAppStore((s) => s.openQueryTab)

  // Inline rename: double-click a tab to edit its title. Enter/click-away commits, Escape cancels.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  const commit = (): void => {
    if (editing) renameTab(editing.id, editing.draft)
    setEditing(null)
  }

  // Menu actions close within the target's group (the visible subtabs).
  const runMenu = (action: TabCloseAction): void => {
    if (!menu) return
    const id = menu.tabId
    if (action === 'close') closeTab(id)
    else if (action === 'others') closeOtherTabs(id)
    else if (action === 'right') closeTabsToRight(id)
    else if (action === 'left') closeTabsToLeft(id)
    else closeAllTabs(id)
  }

  const { data: connections = [] } = useConnections()

  // Groups (top level) are a view over the flat tabs; the active group is the active connection.
  const paneAllTabs = paneTabs(tabs, pane)
  const groups = groupTabs(paneAllTabs)
  const subtabs = paneAllTabs.filter((t) => t.connectionId === activeConnectionId)
  const menuIdx = menu ? subtabs.findIndex((t) => t.id === menu.tabId) : -1

  return (
    <div className="tabbar-wrap">
      {groups.length >= 2 && (
        <div className="tab-groups" role="tablist" aria-label="Server groups">
          {groups.map((g) => {
            const conn = connections.find((c) => c.id === g.connectionId)
            const active = g.connectionId === activeConnectionId
            return (
              <button
                key={g.connectionId}
                role="tab"
                aria-selected={active}
                className={`tab-group${active ? ' active' : ''}`}
                onClick={() => { focusPane(pane); setActiveConnection(g.connectionId) }}
              >
                {conn && (
                  <span
                    className="conn-dot"
                    style={{ background: conn.color, width: 8, height: 8 }}
                    aria-hidden="true"
                  />
                )}
                <span>{conn?.name ?? 'Connection'}</span>
                <span className="tab-group-count">{g.tabs.length}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="tabbar" role="tablist">
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
              className={`tab${tab.id === activeTabId ? ' active' : ''}`}
              title="Double-click to rename"
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
                ×
              </span>
            </button>
          )
        })}
        <button
          className="tab-add btn ghost"
          aria-label="New query tab"
          disabled={!activeConnectionId}
          title={activeConnectionId ? 'New query tab' : 'Connect first'}
          onClick={() => { focusPane(pane); if (activeConnectionId) openQueryTab({ connectionId: activeConnectionId }) }}
        >
          +
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
