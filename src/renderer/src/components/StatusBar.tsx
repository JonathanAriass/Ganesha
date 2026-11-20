import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { rowCountLabel, affectedRowsLabel } from '../lib/result-label'
import { Icon } from './icons'
import { mod } from '../lib/platform'

/** Focus Mode footer: the focused tab's run status + connection identity.
 *  Logic moved from QueryTab's old qt-toolbar statusEl. */
export default function StatusBar(): JSX.Element {
  const tab = useAppStore((s) => {
    const id = s.activeTabByPane[s.focusedPane]
    return id ? s.tabs.find((x) => x.id === id) ?? null : null
  })
  const connId = useAppStore((s) => s.activeConnByPane[s.focusedPane] ?? s.activeConnectionId)
  const { data: connections = [] } = useConnections()
  const conn = connections.find((c) => c.id === connId) ?? null
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const dock = useAppStore((s) => s.dock)
  const toggleAssistant = useAppStore((s) => s.toggleAssistant)
  const toggleSsm = useAppStore((s) => s.toggleSsm)
  const openSettings = useAppStore((s) => s.openSettings)
  const tunnelsRunning = useAppStore((s) => s.runningSsm.length)

  let statusEl: JSX.Element | null = null
  const isQuery = tab && (tab.kind ?? 'query') === 'query'
  if (isQuery && tab.running) {
    statusEl = (
      <span className="sb-status">
        {tab.scriptRun
          ? `Running statement ${Math.min(tab.scriptRun.entries.length + 1, tab.scriptRun.total)} of ${tab.scriptRun.total}…`
          : 'Running…'}
      </span>
    )
  } else if (isQuery && tab.scriptRun) {
    const { entries, total } = tab.scriptRun
    const failedAt = entries.findIndex((e) => e.error !== null)
    const ran = entries.filter((e) => !e.skipped).length
    const ms = entries.reduce((acc, e) => acc + (e.result?.durationMs ?? 0), 0)
    statusEl =
      failedAt !== -1 ? (
        <span className="sb-status err">failed at statement {failedAt + 1} of {total}</span>
      ) : ran < total ? (
        <span className="sb-status err">canceled — ran {ran} of {total} statements</span>
      ) : (
        <span className="sb-status">{total} statements · {ms} ms</span>
      )
  } else if (isQuery && tab.result) {
    const label = tab.result.columns.length === 0 ? affectedRowsLabel(tab.result) : rowCountLabel(tab.result)
    statusEl = <span className="sb-status"><span className="sb-ok">✓</span> {label} · {tab.result.durationMs} ms</span>
  } else if (isQuery && tab.error) {
    statusEl = <span className="sb-status err" title={tab.error}>{tab.error}</span>
  }

  return (
    <footer className="statusbar">
      {statusEl}
      {isQuery && tab.cancelError && (
        <span className="sb-status err" title={tab.cancelError}>Cancel failed — {tab.cancelError}</span>
      )}
      <span className="spacer" />
      {conn && (
        <span className="sb-conn">
          <span className="conn-dot" style={{ background: conn.color }} aria-hidden="true" />
          {conn.name}
          {conn.readOnly && (
            <span className="sb-lock" role="img" aria-label="Read-only connection" title="Read-only connection">
              <Icon name="lock" size={12} />
            </span>
          )}
        </span>
      )}
      {/* With no header, everything global opens from here: search, the two side panels and
          settings. The panel buttons toggle, and stay lit while their panel is open. */}
      <div className="sb-actions" role="group" aria-label="Search, panels and settings">
        <button className="sb-btn" onClick={() => setPaletteOpen(true)} aria-label="Search connections, tables, queries">
          <Icon name="search" size={12} />
          Search
          <kbd>{mod}K</kbd>
        </button>
        <button
          className="sb-btn sb-btn-accent"
          data-dock-toggle="assistant"
          aria-pressed={dock === 'assistant'}
          onClick={toggleAssistant}
        >
          ✦ Assistant
        </button>
        <button
          className="sb-btn"
          data-dock-toggle="tunnels"
          aria-pressed={dock === 'tunnels'}
          aria-label={tunnelsRunning > 0 ? `SSM tunnels (${tunnelsRunning} running)` : 'SSM tunnels'}
          onClick={toggleSsm}
        >
          {tunnelsRunning > 0 && <span className="sb-dot" aria-hidden="true" />}
          Tunnels
        </button>
        <button className="sb-btn" onClick={openSettings} aria-label="Settings" title={`Settings (${mod},)`}>
          <Icon name="gear" size={12} />
          Settings
        </button>
      </div>
    </footer>
  )
}
