import { useAppStore } from '../state/store'
import { useConnections, useCancelQuery } from '../lib/hooks'
import { type PaneId } from '../lib/panes'
import { mod } from '../lib/platform'
import { getTabActions } from '../lib/tab-actions'
import { connectionModeText, connectionHostText } from '../lib/connection-display'
import EnvTag from './EnvTag'
import { Icon } from './icons'

/** The bar under a pane's tab strip: which connection (and environment) the pane's active tab
 *  hits, plus — for query tabs — the run controls, bound to THIS pane's tab. */
export default function EnvBar({ paneId }: { paneId: PaneId }): JSX.Element | null {
  const openSaveQueryModal = useAppStore((s) => s.openSaveQueryModal)
  const requestScriptStop = useAppStore((s) => s.requestScriptStop)
  const setCancelError = useAppStore((s) => s.setCancelError)
  const activeTab = useAppStore((s) => {
    const id = s.activeTabByPane[paneId]
    return id ? s.tabs.find((x) => x.id === id) ?? null : null
  })
  const cancelQuery = useCancelQuery()
  const { data: connections = [] } = useConnections()

  if (!activeTab) return null
  const conn = connections.find((c) => c.id === activeTab.connectionId)
  if (!conn) return null
  const tab = (activeTab.kind ?? 'query') === 'query' ? activeTab : null
  const modeText = connectionModeText(conn)

  return (
    <div
      className="env-bar"
      style={{ background: `color-mix(in srgb, ${conn.color} 9%, transparent)` }}
    >
      <span className="conn-dot" style={{ background: conn.color }} aria-hidden="true" />
      <EnvTag connection={conn} />
      {modeText && <span className="env-bar-mode">{modeText}</span>}
      <span className="env-bar-host">{connectionHostText(conn)}</span>

      {tab && (
        <div className="env-bar-actions">
          <button
            className="btn xs"
            disabled={tab.running || !tab.lastRunText}
            onClick={() => getTabActions(tab.id)?.refresh()}
            title="Refresh — re-run the current query"
            aria-label="Refresh query"
          >
            <Icon name="refresh" />
          </button>
          <button
            className="btn xs"
            disabled={!tab.text.trim()}
            onClick={() =>
              openSaveQueryModal({ mode: 'create', connectionId: tab.connectionId, query: tab.text })
            }
            title="Save query to favourites"
            aria-label="Save query to favourites"
          >
            <Icon name="star" />
          </button>
          <button
            className="btn xs"
            disabled={tab.running || !tab.text.trim()}
            onClick={() => getTabActions(tab.id)?.runAll()}
            title={`Run all statements (${mod}⇧↵)`}
            aria-label="Run all statements"
          >
            Run all
          </button>
          {tab.running && tab.queryId ? (
            <button
              className="btn xs"
              onClick={() => {
                const tabId = tab.id // capture: the error must land on the clicked tab
                if (tab.scriptRun) requestScriptStop(tabId)
                cancelQuery.mutate(
                  { connectionId: tab.connectionId, queryId: tab.queryId! },
                  { onError: (e) => setCancelError(tabId, e instanceof Error ? e.message : String(e)) }
                )
              }}
              aria-label="Cancel query"
            >
              Cancel
            </button>
          ) : (
            <button
              className="btn xs primary"
              disabled={tab.running || !tab.text.trim()}
              onClick={() => getTabActions(tab.id)?.run()}
              title={`Run (${mod}↵) — selection, else statement at cursor`}
              aria-label="Run query"
            >
              <Icon name="play" />
              Run
              <span className="env-bar-hint" aria-hidden="true">{mod}↵</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
