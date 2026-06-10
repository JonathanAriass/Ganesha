import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'

export default function Welcome(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
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

  const conn = connections?.find((c) => c.id === activeConnectionId)

  if (!connections || connections.length === 0) {
    return (
      <div className="welcome">
        <h2>Welcome to DB Client</h2>
        <p>Connect to a Postgres, MySQL, MariaDB, or MongoDB database to get started.</p>
        <button className="btn primary" onClick={() => openModal({ mode: 'create' })}>
          + New connection
        </button>
      </div>
    )
  }

  if (!activeConnectionId || !conn) {
    return (
      <div className="welcome">
        <h2>Select a connection</h2>
        <p>Pick a connection from the dropdown above, or create a new one.</p>
        <button className="btn primary" onClick={() => openModal({ mode: 'create' })}>
          + New connection
        </button>
      </div>
    )
  }

  return (
    <div className="welcome">
      <h2>Connected to {conn.name}</h2>
      <p>
        {conn.type} · {conn.host}:{conn.port} · {conn.database}
        {conn.readOnly ? ' · read-only' : ''}
      </p>
      <p style={{ color: 'var(--text-2)', fontSize: '12px' }}>
        Double-click a table to query it, or open a new query tab.
      </p>
    </div>
  )
}
