import { useState } from 'react'
import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'

export default function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const renameTab = useAppStore((s) => s.renameTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const openQueryTab = useAppStore((s) => s.openQueryTab)

  // Inline rename: double-click a tab to edit its title. Enter/click-away
  // commits, Escape cancels (Chromium fires no blur when the focused input
  // unmounts, so cancel never double-fires through onBlur). Empty commits
  // are rejected by renameTab — the tab keeps its name.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)

  const commit = (): void => {
    if (editing) renameTab(editing.id, editing.draft)
    setEditing(null)
  }

  const { data: connections = [] } = useConnections()

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => {
        const conn = connections.find((c) => c.id === tab.connectionId)
        const dot = conn && (
          <span
            className="conn-dot"
            style={{ background: conn.color, width: 8, height: 8 }}
            aria-hidden="true"
          />
        )
        if (editing?.id === tab.id) {
          // A <div>, not the usual <button>: an input nested in a button is
          // invalid interactive content and its focus/keys misbehave.
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
          >
            {dot}
            <span>{tab.title}</span>
            <span
              className="tab-close"
              role="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
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
        onClick={() => activeConnectionId && openQueryTab({ connectionId: activeConnectionId })}
      >
        +
      </button>
    </div>
  )
}
