import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import EnvTag from './EnvTag'

/** A pane with no active tab: a light empty state for the selected connection (the dashboard
 *  only shows when there are no tabs at all, or via Home). */
export default function PaneEmpty({ connectionId }: { connectionId: string | null }): JSX.Element {
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const { data: connections = [] } = useConnections()
  const conn = connectionId ? connections.find((c) => c.id === connectionId) ?? null : null

  if (!conn) {
    return (
      <div className="pane-empty">
        <p>Select a connection in the sidebar</p>
      </div>
    )
  }
  return (
    <div className="pane-empty">
      <div className="pane-empty-head">
        <span className="conn-dot" style={{ background: conn.color }} aria-hidden="true" />
        <span>{conn.name}</span>
        <EnvTag connection={conn} />
      </div>
      <button className="btn primary" onClick={() => openQueryTab({ connectionId: conn.id })}>
        New query
      </button>
      <p>or double-click a table in the sidebar</p>
    </div>
  )
}
