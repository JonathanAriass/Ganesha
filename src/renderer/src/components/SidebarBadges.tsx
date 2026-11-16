import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { groupTabs } from '../lib/tab-groups'
import { connectionInitials } from '../lib/connection-display'
import { mod } from '../lib/platform'
import { Icon } from './icons'

/** The collapsed sidebar: Expand, Home, one badge per connection with open tabs
 *  (initials over a bar in its colour; click selects it), then + to expand to the
 *  full list. Badges scroll on their own, so they carry a native tooltip — a styled
 *  one would be clipped by the scroll box. */
export default function SidebarBadges(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const toggleSide = useAppStore((s) => s.toggleSide)
  const dashboardOpen = useAppStore((s) => s.dashboardOpen)
  const toggleDashboard = useAppStore((s) => s.toggleDashboard)

  const { data: connections = [] } = useConnections()
  const byId = new Map(connections.map((c) => [c.id, c]))
  // A tab whose connection is gone (deleted, list still loading) gets no badge.
  const open = groupTabs(tabs).flatMap((g) => byId.get(g.connectionId) ?? [])

  return (
    <nav className="sidebar-badges" aria-label="Connections">
      <button
        className="icon-btn"
        onClick={toggleSide}
        aria-label="Expand sidebar"
        data-tooltip={`Expand sidebar (${mod}B)`}
        data-tip="beside"
      >
        <Icon name="sidebar" />
      </button>
      <button
        className={`icon-btn${dashboardOpen ? ' active' : ''}`}
        onClick={toggleDashboard}
        aria-label="Connections dashboard"
        aria-pressed={dashboardOpen}
        data-tooltip="Connections dashboard"
        data-tip="beside"
      >
        <Icon name="home" />
      </button>
      <div className="sidebar-badge-list">
        {open.map((c) => (
          <button
            key={c.id}
            className={`sidebar-badge${c.id === activeConnectionId ? ' active' : ''}`}
            onClick={() => setActiveConnection(c.id)}
            aria-label={c.name}
            aria-pressed={c.id === activeConnectionId}
            title={c.name}
          >
            <span aria-hidden="true">{connectionInitials(c.name)}</span>
            <span className="sidebar-badge-bar" style={{ background: c.color }} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        className="icon-btn"
        onClick={toggleSide}
        aria-label="Show all connections"
        data-tooltip="All connections"
        data-tip="beside"
      >
        <Icon name="plus" />
      </button>
    </nav>
  )
}
