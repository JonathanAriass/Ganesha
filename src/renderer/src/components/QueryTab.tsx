import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryTabData } from '../state/store'
import { useAppStore } from '../state/store'
import { useConnections, useRunQuery, useCancelQuery, useObjects } from '../lib/hooks'
import MonacoEditor from './MonacoEditor'
import ResultsPanel from './ResultsPanel'
import type { ConnectionType } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'
import { mod } from '../lib/platform'
import { rowCountLabel } from '../lib/result-label'
import { unwrap } from '../lib/result'
import type { CompletionCtx } from '../lib/monaco-completions'

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

  const { data: objects = [] } = useObjects(tab.connectionId)
  const queryClient = useQueryClient()
  // Editor completions. getColumns shares the schema tree's cache entry — the key
  // must match useColumns exactly. Identity per render is fine: MonacoEditor reads
  // it through a ref-thunk, never as an effect dependency.
  const completions: CompletionCtx = {
    objects,
    getColumns: (ref: ObjectRef) =>
      queryClient.fetchQuery({
        queryKey: ['columns', tab.connectionId, ref.schema, ref.name],
        queryFn: () => window.api.schema.columns(tab.connectionId, ref).then(unwrap),
        staleTime: 60_000, // don't re-IPC on every keystroke behind `alias.`
        retry: false // like every IPC query here — fail fast to "no suggestions", not 3 backoffs
      })
  }

  function run(textOverride?: string) {
    const text = textOverride ?? tab.text
    // Re-checks live tab.running each render (run is recreated per render) — keep that if memoizing.
    if (!text.trim() || tab.running) return
    cancelQuery.reset() // a stale "Cancel failed" must not haunt the next run
    const queryId = crypto.randomUUID()
    startRun(tab.id, queryId)
    runQuery
      .mutateAsync({ connectionId: tab.connectionId, query: text, queryId })
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
    // A Cancel that silently does nothing is worse than no button — some servers
    // (e.g. Atlas free tier) refuse $currentOp/killOp, so surface the failure.
    statusEl = (
      <>
        <span className="qt-status">Running…</span>
        {cancelQuery.isError && (
          <span className="qt-status err">
            {cancelQuery.error instanceof Error ? cancelQuery.error.message : String(cancelQuery.error)}
          </span>
        )}
      </>
    )
  } else if (tab.result) {
    statusEl = (
      <span className="qt-status">
        {rowCountLabel(tab.result)} · {tab.result.durationMs} ms
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
          // Not onClick={run}: the MouseEvent would land in textOverride.
          onClick={() => run()}
          title={`Run (${mod}↵ — a selection runs by itself)`}
        >
          ▶ Run
        </button>
        {/* All drivers cancel for real now: pg_cancel_backend / KILL QUERY /
            mongo killOp on the comment-tagged op. */}
        {tab.running && tab.queryId && (
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
        completions={completions}
      />
      <ResultsPanel tab={tab} />
    </div>
  )
}
