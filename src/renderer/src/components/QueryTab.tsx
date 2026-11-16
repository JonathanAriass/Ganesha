import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryTabData } from '../state/store'
import { useAppStore } from '../state/store'
import { useConnections, useRunQuery, useObjects, useDatabases } from '../lib/hooks'
import MonacoEditor, { type MonacoEditorHandle } from './MonacoEditor'
import ResultsPanel from './ResultsPanel'
import type { ConnectionType } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'
import { unwrap } from '../lib/result'
import { setTabActions, clearTabActions } from '../lib/tab-actions'
import type { CompletionCtx } from '../lib/monaco-completions'
import {
  splitSqlStatements,
  splitJsCommands,
  statementAt,
  isTransactionControl,
  type SqlDialect,
  type Statement
} from '../lib/statements'
import {
  clampFraction,
  dragFraction,
  loadEditorFraction,
  saveEditorFraction,
  DEFAULT_EDITOR_FRACTION,
  MIN_EDITOR_FRACTION,
  MAX_EDITOR_FRACTION
} from '../lib/split'

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
  const startScript = useAppStore((s) => s.startScript)
  const scriptStatementStart = useAppStore((s) => s.scriptStatementStart)
  const scriptStatementDone = useAppStore((s) => s.scriptStatementDone)
  const finishScript = useAppStore((s) => s.finishScript)

  const runQuery = useRunQuery()

  const { data: objects = [] } = useObjects(tab.connectionId)
  // Database/schema name suggestions are SQL-only; Mongo completes databases via getSiblingDB.
  const { data: databases = [] } = useDatabases(tab.connectionId, connection?.type !== 'mongodb')
  const queryClient = useQueryClient()
  // Editor completions. getColumns shares the schema tree's cache entry — the key
  // must match useColumns exactly. Identity per render is fine: MonacoEditor reads
  // it through a ref-thunk, never as an effect dependency.
  const completions: CompletionCtx = {
    objects,
    databases,
    getColumns: (ref: ObjectRef) =>
      queryClient.fetchQuery({
        queryKey: ['columns', tab.connectionId, ref.schema, ref.name],
        queryFn: () => window.api.schema.columns(tab.connectionId, ref).then(unwrap),
        staleTime: 60_000, // don't re-IPC on every keystroke behind `alias.`
        retry: false // like every IPC query here — fail fast to "no suggestions", not 3 backoffs
      })
  }

  const editorRef = useRef<MonacoEditorHandle>(null)

  // ── Editor/results split ──
  const containerRef = useRef<HTMLDivElement>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  // Global preference; a remount (tab switch) picks up the latest saved value.
  const [editorFraction, setEditorFraction] = useState(() => loadEditorFraction())
  const dragFracRef = useRef(editorFraction)

  function commitFraction(f: number): void {
    dragFracRef.current = f
    setEditorFraction(f)
    saveEditorFraction(f)
  }

  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault() // keep the drag from starting a text selection in Monaco/grid
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onDividerPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return // hover, not a drag
    const container = containerRef.current
    const pane = editorPaneRef.current
    if (!container || !pane) return
    const f = dragFraction(
      e.clientY,
      pane.getBoundingClientRect().top, // the pane's TOP edge is fixed during a drag
      container.getBoundingClientRect().height
    )
    dragFracRef.current = f
    // Direct DOM write while dragging — a React re-render per pointermove would
    // re-render the results grid too, and unmemoized work under useVirtualizer
    // runs per frame (the row-inspector lesson). React state + localStorage are
    // committed once, on pointerup; Monaco follows via automaticLayout.
    pane.style.flexBasis = `${f * 100}%`
  }

  function onDividerPointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    commitFraction(dragFracRef.current)
  }

  function onDividerKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const step = e.key === 'ArrowUp' ? -0.02 : e.key === 'ArrowDown' ? 0.02 : null
    if (step === null) return
    e.preventDefault() // arrows must resize, not scroll the page
    // Base the step on the ref, not the editorFraction closure: repeats that
    // batch within one tick (before a re-render) would all read the same stale
    // state value and collapse to a single step. The ref always holds the latest.
    commitFraction(clampFraction(dragFracRef.current + step))
  }

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
    const queryId = crypto.randomUUID()
    startRun(tab.id, queryId, text)
    runQuery
      .mutateAsync({ connectionId: tab.connectionId, query: text, queryId })
      .then((result) => finishRun(tab.id, { result }))
      .catch((e) => finishRun(tab.id, { error: e instanceof Error ? e.message : String(e) }))
  }

  /** Re-run the exact query behind the current results — the environment bar's Refresh button. Uses
   *  lastRunText (not the live editor text), so it reloads the shown rows even if the
   *  editor has since been edited or the cursor moved. */
  function refresh(): void {
    if (tab.lastRunText && !tab.running) run(tab.lastRunText)
  }

  // Expose run handlers to the pane's environment bar (EnvBar). Ref-thunk so the
  // registry always sees this render's closures; registered once per mount.
  // useLayoutEffect (not useEffect): registration must precede the first paint
  // so a run-button click can never land in an unregistered window.
  const actionsRef = useRef({ run: () => run(), runAll: () => void runAll(), refresh })
  actionsRef.current = { run: () => run(), runAll: () => void runAll(), refresh }
  useLayoutEffect(() => {
    setTabActions(tab.id, () => actionsRef.current)
    return () => clearTabActions(tab.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tab.id is stable for a mounted tab
  }, [])

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
    startScript(tab.id, statements.length, crypto.randomUUID())
    let failed = false
    for (const st of statements) {
      // Fresh getState() each boundary — this closure's snapshot predates any
      // close or cancel. A closed tab (⌘W) must stop the script: the store
      // appends would no-op, but the IPC calls would keep executing statements
      // with Cancel gone from the UI. The stop flag lives on the tab's
      // scriptRun (not on this component — it remounts on tab switches).
      const live = useAppStore.getState().tabs.find((t) => t.id === tab.id)
      if (!live) return
      if (failed || live.scriptRun?.stopRequested) {
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

  return (
    <div className="querytab" ref={containerRef}>
      <div
        className="qt-editor-pane"
        ref={editorPaneRef}
        style={{ flexBasis: `${editorFraction * 100}%` }}
      >
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
      </div>
      <div
        className="qt-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize editor and results"
        aria-valuemin={Math.round(MIN_EDITOR_FRACTION * 100)}
        aria-valuemax={Math.round(MAX_EDITOR_FRACTION * 100)}
        aria-valuenow={Math.round(editorFraction * 100)}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerEnd}
        onPointerCancel={onDividerPointerEnd}
        onDoubleClick={() => commitFraction(DEFAULT_EDITOR_FRACTION)}
        onKeyDown={onDividerKeyDown}
      />
      <ResultsPanel tab={tab} />
    </div>
  )
}
