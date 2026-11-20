import { useAppStore } from '../state/store'
import { useSsmTunnels } from '../lib/hooks'

/** There is no header any more (search is ⌘K, the panels open from the right edge): what is
 *  left at the top is the warning for a linked tunnel that is not running. */
export default function TopBar(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
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
