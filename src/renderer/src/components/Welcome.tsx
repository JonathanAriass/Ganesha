import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { mod } from '../lib/platform'

/** The empty-pane view, now a connections dashboard: every connection as a
 *  card (click = select, double-click = open a query tab, ✎ = edit), plus a
 *  dashed "New connection" card. The TopBar dropdown remains the quick picker;
 *  this is the visual overview. */
export default function Welcome(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const openModal = useAppStore((s) => s.openModal)

  const { data: connections, isLoading, error } = useConnections()

  if (isLoading) {
    return (
      <div className="welcome">
        <p style={{ color: 'var(--text-2)' }}>Loading connections…</p>
      </div>
    )
  }

  if (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return (
      <div className="welcome">
        <div className="error" role="alert">
          <strong>Failed to load connections</strong>
          <span>{msg}</span>
        </div>
      </div>
    )
  }

  if (!connections || connections.length === 0) {
    return (
      <div className="welcome">
        <h2>Welcome to Ganesha</h2>
        <p>Connect to a Postgres, MySQL, MariaDB, or MongoDB database to get started.</p>
        <button className="btn primary" onClick={() => openModal({ mode: 'create' })}>
          + New connection
        </button>
      </div>
    )
  }

  return (
    <div className="dash">
      <h2 className="dash-title">Connections</h2>
      <p className="dash-sub">Click a card to select it — double-click to open a query tab.</p>
      <div className="dash-grid">
        {connections.map((c) => (
          <button
            key={c.id}
            className={`dash-card${c.id === activeConnectionId ? ' active' : ''}`}
            style={{ ['--card-accent' as never]: c.color }}
            // detail guard: the first click of a double-click already selects; the
            // second shouldn't re-fire before onDoubleClick opens the tab.
            onClick={(e) => {
              if (e.detail === 1) setActiveConnection(c.id)
            }}
            onDoubleClick={() => {
              setActiveConnection(c.id)
              openQueryTab({ connectionId: c.id })
            }}
            aria-pressed={c.id === activeConnectionId}
          >
            <span className="dash-card-strip" aria-hidden="true" />
            <span className="dash-card-head">
              <span className="dash-card-name">{c.name}</span>
              {/* span-as-button: a real <button> can't nest inside the card button */}
              <span
                className="dash-card-edit"
                role="button"
                tabIndex={0}
                aria-label={`Edit ${c.name}`}
                title="Edit connection"
                onClick={(e) => {
                  e.stopPropagation()
                  openModal({ mode: 'edit', id: c.id })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    openModal({ mode: 'edit', id: c.id })
                  }
                }}
              >
                ✎
              </span>
            </span>
            <span className="dash-card-meta">
              <span className="dash-badge">{c.type}</span>
              {c.readOnly && (
                <span className="dash-badge lock" title="Read-only connection">
                  🔒 read-only
                </span>
              )}
            </span>
            <span className="dash-card-host">
              {c.host}:{c.port}
              {c.database ? ` · ${c.database}` : ''}
            </span>
            {c.id === activeConnectionId && (
              <span className="dash-card-check" aria-hidden="true">
                ✓ active
              </span>
            )}
          </button>
        ))}
        <button className="dash-card new" onClick={() => openModal({ mode: 'create' })}>
          <span className="dash-new-plus" aria-hidden="true">
            ＋
          </span>
          <span>New connection</span>
        </button>
      </div>
      <p className="dash-hint">
        {mod}K palette · double-click a table to query it · {mod}B toggles the side panel
      </p>
    </div>
  )
}
