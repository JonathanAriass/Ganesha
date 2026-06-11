import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryTabData } from '../state/store'
import { useAppStore } from '../state/store'
import { useConnections, useRunQuery, useCancelQuery, useObjects } from '../lib/hooks'
import MonacoEditor, { type MonacoEditorHandle } from './MonacoEditor'
import ResultsPanel from './ResultsPanel'
import type { ConnectionType } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'
import { mod } from '../lib/platform'
import { rowCountLabel } from '../lib/result-label'
import { unwrap } from '../lib/result'
import type { CompletionCtx } from '../lib/monaco-completions'
import {
  splitSqlStatements,
  splitJsCommands,
  statementAt,
  isTransactionControl,
  type SqlDialect,
  type Statement
} from '../lib/statements'

function langFor(type: ConnectionType | undefined): string {
  return type === 'mongodb' ? 'javascript' : 'sql'
}

function sqlDialectFor(type: ConnectionType | undefined): SqlDialect {
  return type === 'mysql' || type === 'mariadb' ? 'mysql' : 'postgres'
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
  const openSaveQueryModal = useAppStore((s) => s.openSaveQueryModal)
  const startScript = useAppStore((s) => s.startScript)
  const scriptStatementStart = useAppStore((s) => s.scriptStatementStart)
  const scriptStatementDone = useAppStore((s) => s.scriptStatementDone)
  const finishScript = useAppStore((s) => s.finishScript)

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

  const editorRef = useRef<MonacoEditorHandle>(null)
  // Set by Cancel while a script runs: the cancel IPC itself can miss — the
  // targeted statement may finish (driver no-ops on an unknown queryId) just as
  // the user clicks — so runAll also checks this at every statement boundary.
  // A ref, not state: the loop must see the click mid-flight, and render
  // closures would be stale.
  const scriptStopRef = useRef(false)

  /** The tab's text split with this connection's dialect rules. */
  function tabStatements(): Statement[] {
    return langFor(connection?.type) === 'sql'
      ? splitSqlStatements(tab.text, sqlDialectFor(connection?.type))
      : splitJsCommands(tab.text)
  }

  /** What ⌘↵/Run executes: the selection if there is one, else the statement
   *  under the cursor when the tab holds several, else the whole tab. */
  function runnableText(): string {
    const editor = editorRef.current
    if (!editor) return tab.text // runOnOpen can fire before the editor mounts
    const selection = editor.selectionText()
    if (selection) return selection
    const statements = tabStatements()
    // A single statement (or none — all comments) runs as the whole tab, so
    // single-statement tabs behave exactly as before this feature existed.
    if (statements.length < 2) return tab.text
    return statementAt(tab.text, statements, editor.cursorOffset())?.text ?? tab.text
  }

  function run(textOverride?: string) {
    const text = textOverride ?? runnableText()
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

  /** Run every statement in the tab, top to bottom, stopping at the first error
   *  (later statements report as skipped — scripts assume their predecessors ran).
   *  Each statement is its own query.run, so the read-only guard, history, and
   *  Cancel (via the per-statement queryId in tab.queryId) all apply per statement. */
  async function runAll(): Promise<void> {
    if (!tab.text.trim() || tab.running) return
    const statements = tabStatements()
    // 0 or 1 statements: one plain run — of the whole tab, not the selection.
    // "Run all" means everything even when a selection happens to exist.
    if (statements.length < 2) return run(tab.text)
    if (langFor(connection?.type) === 'sql') {
      // Statements run as separate pooled sessions: BEGIN/COMMIT can't span them,
      // and a lone BEGIN would return to the pool still open, haunting later runs.
      // Refusing beats silently-broken transaction semantics.
      const txn = statements.find((st) => isTransactionControl(st.text))
      if (txn) {
        finishRun(tab.id, {
          error:
            'Run all executes statements one at a time on separate pooled sessions, so ' +
            'transaction control (BEGIN/COMMIT/ROLLBACK/…) can’t span them. Remove the ' +
            'transaction statements — each statement commits on its own.'
        })
        return
      }
    }
    cancelQuery.reset()
    scriptStopRef.current = false
    startScript(tab.id, statements.length, crypto.randomUUID())
    let failed = false
    for (const st of statements) {
      // The tab can close mid-script (⌘W): the store appends would no-op, but
      // the IPC calls would keep executing statements with Cancel gone from the
      // UI. Fresh getState() — this closure's tab list predates the close.
      if (!useAppStore.getState().tabs.some((t) => t.id === tab.id)) return
      if (failed || scriptStopRef.current) {
        scriptStatementDone(tab.id, { text: st.text, result: null, error: null, skipped: true })
        continue
      }
      const queryId = crypto.randomUUID()
      scriptStatementStart(tab.id, queryId)
      try {
        const result = await runQuery.mutateAsync({
          connectionId: tab.connectionId,
          query: st.text,
          queryId
        })
        scriptStatementDone(tab.id, { text: st.text, result, error: null, skipped: false })
      } catch (e) {
        scriptStatementDone(tab.id, {
          text: st.text,
          result: null,
          error: e instanceof Error ? e.message : String(e),
          skipped: false
        })
        failed = true
      }
    }
    finishScript(tab.id)
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
    const label = tab.scriptRun
      ? `Running statement ${Math.min(tab.scriptRun.entries.length + 1, tab.scriptRun.total)} of ${tab.scriptRun.total}…`
      : 'Running…'
    // A Cancel that silently does nothing is worse than no button — some servers
    // (e.g. Atlas free tier) refuse $currentOp/killOp, so surface the failure.
    statusEl = (
      <>
        <span className="qt-status">{label}</span>
        {cancelQuery.isError && (
          <span className="qt-status err">
            {cancelQuery.error instanceof Error ? cancelQuery.error.message : String(cancelQuery.error)}
          </span>
        )}
      </>
    )
  } else if (tab.scriptRun) {
    const { entries, total } = tab.scriptRun
    const failedAt = entries.findIndex((e) => e.error !== null)
    const ran = entries.filter((e) => !e.skipped).length
    const ms = entries.reduce((acc, e) => acc + (e.result?.durationMs ?? 0), 0)
    statusEl =
      failedAt !== -1 ? (
        <span className="qt-status err">failed at statement {failedAt + 1} of {total}</span>
      ) : ran < total ? (
        // Cancel landed between statements: nothing errored, the rest skipped.
        <span className="qt-status err">canceled — ran {ran} of {total} statements</span>
      ) : (
        <span className="qt-status">
          {total} statements · {ms} ms
        </span>
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
          onClick={() => run()}
          title={`Run (${mod}↵) — runs the selection, else the statement at the cursor`}
        >
          ▶ Run
        </button>
        <button
          className="btn"
          disabled={tab.running || !tab.text.trim()}
          onClick={() => void runAll()}
          title={`Run all statements, top to bottom (${mod}⇧↵) — stops at the first error`}
        >
          ▶▶ Run all
        </button>
        <button
          className="btn ghost"
          disabled={!tab.text.trim()}
          onClick={() =>
            openSaveQueryModal({ mode: 'create', connectionId: tab.connectionId, query: tab.text })
          }
          title={`Save query (${mod}S)`}
        >
          ☆ Save
        </button>
        {/* All drivers cancel for real now: pg_cancel_backend / KILL QUERY /
            mongo killOp on the comment-tagged op. */}
        {tab.running && tab.queryId && (
          <button
            className="btn ghost"
            onClick={() => {
              // For scripts, also stop at the next boundary — this render's
              // queryId may belong to a statement that just finished, and the
              // drivers no-op (successfully) on ids they no longer know.
              if (tab.scriptRun) scriptStopRef.current = true
              cancelQuery.mutate({ connectionId: tab.connectionId, queryId: tab.queryId! })
            }}
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
        ref={editorRef}
        initialValue={tab.text}
        language={langFor(connection?.type)}
        onChange={(t) => setTabText(tab.id, t)}
        onRun={run}
        onRunAll={() => void runAll()}
        completions={completions}
      />
      <ResultsPanel tab={tab} />
    </div>
  )
}
