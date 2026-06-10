import { useEffect, useRef } from 'react'
import type { QueryTabData } from '../state/store'
import { useAppStore } from '../state/store'
import { useConnections, useRunQuery, useCancelQuery } from '../lib/hooks'
import MonacoEditor from './MonacoEditor'
import ResultsPanel from './ResultsPanel'
import type { ConnectionType } from '@shared/domain'

function langFor(type: ConnectionType | undefined): string {
  return type === 'mongodb' ? 'javascript' : 'sql'
}

interface Props {
  tab: QueryTabData
}

export default function QueryTab({ tab }: Props): JSX.Element {
  const { data: connections = [] } = useConnections()
  const connection = connections.find((c) => c.id === tab.connectionId)

  const setTabText = useAppStore((s) => s.setTabText)
  const startRun = useAppStore((s) => s.startRun)
  const finishRun = useAppStore((s) => s.finishRun)

  const runQuery = useRunQuery()
  const cancelQuery = useCancelQuery()

  function run() {
    // Re-checks live tab.running each render (run is recreated per render) — keep that if memoizing.
    if (!tab.text.trim() || tab.running) return
    const queryId = crypto.randomUUID()
    startRun(tab.id, queryId)
    runQuery
      .mutateAsync({ connectionId: tab.connectionId, query: tab.text, queryId })
      .then((result) => finishRun(tab.id, { result }))
      .catch((e) => finishRun(tab.id, { error: e instanceof Error ? e.message : String(e) }))
  }

  const hasRunRef = useRef(false)
  useEffect(() => {
    if (tab.runOnOpen && !hasRunRef.current) {
      hasRunRef.current = true
      run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: auto-run once on mount
  }, [])

  let statusEl: JSX.Element | null = null
  if (tab.running) {
    statusEl = <span className="qt-status">Running…</span>
  } else if (tab.result) {
    statusEl = (
      <span className="qt-status">
        {tab.result.rowCount} rows · {tab.result.durationMs} ms
      </span>
    )
  } else if (tab.error) {
    statusEl = <span className="qt-status err">{tab.error}</span>
  }

  return (
    <div className="querytab">
      <div className="qt-toolbar">
        <button
          className="btn primary"
          disabled={tab.running || !tab.text.trim()}
          onClick={run}
          title="Run (⌘↵)"
        >
          ▶ Run
        </button>
        {/* Mongo ops can't be killed mid-flight (driver cancel is a no-op; they
            bound themselves via maxTimeMS) — a Cancel that silently does nothing
            is worse than no button. */}
        {tab.running && tab.queryId && connection?.type !== 'mongodb' && (
          <button
            className="btn ghost"
            onClick={() =>
              cancelQuery.mutate({ connectionId: tab.connectionId, queryId: tab.queryId! })
            }
          >
            Cancel
          </button>
        )}
        {connection && (
          <span className="conn-chip">
            <span
              className="conn-dot"
              style={{ background: connection.color, width: 8, height: 8 }}
              aria-hidden="true"
            />
            {connection.name}
            {connection.readOnly && ' 🔒'}
          </span>
        )}
        {statusEl}
      </div>
      <MonacoEditor
        key={`${tab.id}:${tab.epoch}`}
        initialValue={tab.text}
        language={langFor(connection?.type)}
        onChange={(t) => setTabText(tab.id, t)}
        onRun={run}
      />
      <ResultsPanel tab={tab} />
    </div>
  )
}
