import { useAppStore } from '../state/store'
import { useSsmTunnels } from '../lib/hooks'
import { mod } from '../lib/platform'
import { Icon } from './icons'
import logo from '../assets/logo.png'

export default function TopBar(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openSettings = useAppStore((s) => s.openSettings)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const toggleAssistant = useAppStore((s) => s.toggleAssistant)
  const assistantOpen = useAppStore((s) => s.dock === 'assistant')
  const toggleSsm = useAppStore((s) => s.toggleSsm)
  const ssmOpen = useAppStore((s) => s.dock === 'tunnels')
  const runningSsm = useAppStore((s) => s.runningSsm)

  const { data: tunnels = [] } = useSsmTunnels()

  // Tunnels linked to the active connection that aren't currently running → offer to start.
  const downLinked = activeConnectionId
    ? tunnels.filter((t) => t.connectionId === activeConnectionId && !runningSsm.includes(t.id))
    : []

  return (
    <>
    <header className="topbar">
      <img className="brand-logo" src={logo} alt="Ganesha" title="Ganesha" />

      <div className="topbar-center">
        <button
          className="topbar-search"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search connections, tables, queries"
        >
          <Icon name="search" />
          <span className="topbar-search-label">Search connections, tables, queries</span>
          <span className="topbar-search-hint" aria-hidden="true">{mod}K</span>
        </button>
      </div>

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
