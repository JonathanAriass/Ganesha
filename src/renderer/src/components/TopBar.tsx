import type { ChangeEvent } from 'react'
import { useAppStore } from '../state/store'
import { useConnections, useSsmTunnels } from '../lib/hooks'
import { mod } from '../lib/platform'
import { Icon } from './icons'
import logo from '../assets/logo.png'

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
  const openDiagramTab = useAppStore((s) => s.openDiagramTab)

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
      <img className="brand-logo" src={logo} alt="Ganesha" title="Ganesha" />

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
          className="icon-btn"
          onClick={() => openModal({ mode: 'edit', id: activeConn.id })}
          aria-label="Edit active connection"
          data-tooltip="Edit connection"
        >
          <Icon name="pencil" />
        </button>
      )}

      {activeConn && (
        <button
          className="icon-btn"
          onClick={() => openDiagramTab(activeConn.id)}
          aria-label="Schema diagram"
          data-tooltip="Schema diagram"
        >
          <Icon name="diagram" />
        </button>
      )}

      <span className="spacer" />

      <button className="icon-btn" onClick={() => openModal({ mode: 'create' })} aria-label="New connection" data-tooltip="New connection" data-tip="right">
        <Icon name="plus" />
      </button>

      <button
        className={`icon-btn${assistantOpen ? ' active' : ''}`}
        onClick={toggleAssistant}
        aria-label="Toggle assistant"
        aria-pressed={assistantOpen}
        data-tooltip="Assistant"
        data-tip="right"
      >
        <Icon name="chat" />
      </button>

      <button
        className={`icon-btn${ssmOpen ? ' active' : ''}`}
        onClick={toggleSsm}
        aria-label="Toggle SSM tunnels"
        aria-pressed={ssmOpen}
        data-tooltip="SSM tunnels"
        data-tip="right"
      >
        <Icon name="plug" />
      </button>

      <button className="icon-btn" onClick={openSettings} aria-label="Settings" data-tooltip={`Settings (${mod},)`} data-tip="right">
        <Icon name="gear" />
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
