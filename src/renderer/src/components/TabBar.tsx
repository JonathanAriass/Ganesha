import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'

export default function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const openQueryTab = useAppStore((s) => s.openQueryTab)

  const { data: connections = [] } = useConnections()

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => {
        const conn = connections.find((c) => c.id === tab.connectionId)
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={`tab${tab.id === activeTabId ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {conn && (
              <span
                className="conn-dot"
                style={{ background: conn.color, width: 8, height: 8 }}
                aria-hidden="true"
              />
            )}
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
