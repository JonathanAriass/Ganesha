import type { ChangeEvent } from 'react'
import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { mod } from '../lib/platform'

export default function TopBar(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openModal = useAppStore((s) => s.openModal)
  const openSettings = useAppStore((s) => s.openSettings)

  const { data: connections = [] } = useConnections()

  const activeConn = connections.find((c) => c.id === activeConnectionId) ?? null

  function handleSelectChange(e: ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setActiveConnection(val === '' ? null : val)
  }

  return (
    <header className="topbar">
      <span className="brand">DB Client</span>

      {activeConn && (
        <span
          className="conn-dot"
          style={{ background: activeConn.color }}
          aria-hidden="true"
        />
      )}

      <select
        className="conn-select"
        value={activeConnectionId ?? ''}
        onChange={handleSelectChange}
        aria-label="Active connection"
      >
        <option value="">— no connection —</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.type}){c.readOnly ? ' 🔒' : ''}
          </option>
        ))}
      </select>

      {activeConn && (
        <button
          className="btn ghost"
          onClick={() => openModal({ mode: 'edit', id: activeConn.id })}
          aria-label="Edit active connection"
        >
          Edit
        </button>
      )}

      <span className="spacer" />

      <button
        className="btn primary"
        onClick={() => openModal({ mode: 'create' })}
      >
        + New connection
      </button>

      <button
        className="btn ghost"
        onClick={openSettings}
        aria-label="Settings"
        title={`Settings (${mod},)`}
      >
        ⚙
      </button>
    </header>
  )
}
