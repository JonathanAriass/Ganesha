import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'
import { rowCountLabel, affectedRowsLabel } from '../lib/result-label'
import { Icon } from './icons'

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
    </footer>
  )
}
