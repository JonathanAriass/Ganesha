import type { ChangeEvent } from 'react'
import { useAppStore } from '../state/store'
import { useConnections, useSsmTunnels } from '../lib/hooks'
import { mod } from '../lib/platform'

export default function TopBar(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openModal = useAppStore((s) => s.openModal)
  const openSettings = useAppStore((s) => s.openSettings)
  const toggleAssistant = useAppStore((s) => s.toggleAssistant)
  const assistantOpen = useAppStore((s) => s.assistantOpen)
  const toggleSsm = useAppStore((s) => s.toggleSsm)
  const ssmOpen = useAppStore((s) => s.ssmOpen)
  const runningSsm = useAppStore((s) => s.runningSsm)

  const { data: connections = [] } = useConnections()
  const { data: tunnels = [] } = useSsmTunnels()

  const activeConn = connections.find((c) => c.id === activeConnectionId) ?? null
  // Tunnels linked to the active connection that aren't currently running → offer to start.
  const downLinked = activeConnectionId
    ? tunnels.filter((t) => t.connectionId === activeConnectionId && !runningSsm.includes(t.id))
    : []

  function handleSelectChange(e: ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setActiveConnection(val === '' ? null : val)
  }

  return (
    <>
    <header className="topbar">
      <span className="brand">Ganesha</span>

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
        className={`btn ghost${assistantOpen ? ' active' : ''}`}
        onClick={toggleAssistant}
        aria-label="Toggle assistant"
        aria-pressed={assistantOpen}
        title="AI assistant"
      >
        💬 Assistant
      </button>

      <button
        className={`btn ghost${ssmOpen ? ' active' : ''}`}
        onClick={toggleSsm}
        aria-label="Toggle SSM tunnels"
        aria-pressed={ssmOpen}
        title="SSM tunnels"
      >
        🔌 Tunnels
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

    {downLinked.map((t) => (
      <div className="ssm-banner" key={t.id} role="status">
        ⚠ Tunnel <strong>{t.name}</strong> (127.0.0.1:{t.localPort}) is not running.
        <button
          className="btn xs primary"
          onClick={() => { void window.api.ssm.start(t.id); if (!ssmOpen) toggleSsm() }}
        >
          Start tunnel
        </button>
      </div>
    ))}
    </>
  )
}
