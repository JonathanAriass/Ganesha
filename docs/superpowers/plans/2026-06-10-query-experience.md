# Plan 4b — Query Experience (Monaco · tabs · grid · documents · history)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The core loop, live: open a query tab (or double-click a table), type SQL or Mongo (shell/JSON) in a locally-bundled Monaco editor, hit **⌘Enter**, see results in a **virtualized grid** (sort, filter, copy, CSV/JSON export) or the **document tree** for Mongo, cancel in-flight queries, and re-run from **history**.

**Architecture:** One small backend change — the renderer generates the `queryId` and passes it through `query.run`, so Cancel can target the in-flight query. Everything else is renderer: Monaco bundled locally (Vite `?worker` imports — no CDN), tabs in the Zustand store (text/result/running state live per-tab so switching preserves results), TanStack Table + Virtual for the grid, a dependency-free `<details>`-based JSON tree for documents, blob-download exports (no new IPC), and a history section in the sidebar fed by the existing `history.list` channel.

**Deliberate v1 notes:** Mongo `documents` keep EJSON *relaxed* mode (ints >2^53 lose precision — documented limitation, revisit on demand). Tab state is in-memory (not persisted). Monaco JS diagnostics are disabled so `db.…` shell input shows no bogus squiggles.

**This is Plan 4b** (4a ✓ → **4b** → 4c palette/settings/polish). Builds on `main`. Demo postgres `dbclient-demo` (localhost:55432) is running for the live demo.

---

## File Structure

```
src/shared/ipc.ts / api.ts, src/preload/index.ts, src/main/ipc.ts, src/main/query-service.ts(+test)
                                   MODIFY — query.run req gains queryId (renderer-generated)
src/renderer/src/lib/monaco.ts     CREATE — worker env + midnight theme + JS diagnostics off
src/renderer/src/components/MonacoEditor.tsx  CREATE — thin wrapper (⌘Enter, onChange)
src/renderer/src/state/store.ts    MODIFY — query tabs slice
src/renderer/src/lib/tabquery.ts   CREATE — defaultTableQuery(type, ref)
src/renderer/src/lib/hooks.ts      MODIFY — useRunQuery, useCancelQuery, useHistory
src/renderer/src/lib/export.ts     CREATE — toCsv / toJsonText / download
src/renderer/src/components/{TabBar,QueryTab,ResultsPanel,ResultsGrid,DocumentView,HistorySection}.tsx  CREATE
src/renderer/src/components/{App layout, Welcome copy, ObjectTree dblclick, TopBar type-import nit}  MODIFY
src/renderer/src/styles.css        MODIFY — tabbar/editor/grid/docview/history classes
package.json                       MODIFY — monaco-editor, @tanstack/react-table, @tanstack/react-virtual
```

---

## Task 1: queryId through the pipeline (backend, small)

- [ ] **Step 1:** `src/shared/ipc.ts` — `'query.run': { req: { connectionId: string; query: string; queryId: string }; res: QueryResult }`.
- [ ] **Step 2:** `src/shared/api.ts` — `run(connectionId: string, query: string, queryId: string): Promise<IpcResult<'query.run'>>`.
- [ ] **Step 3:** `src/preload/index.ts` — `run: (connectionId, query, queryId) => invoke('query.run', { connectionId, query, queryId })`.
- [ ] **Step 4:** `src/main/query-service.ts` — `RunArgs` gains `queryId: string`; `runQuery(..., { maxRows: DEFAULT_MAX_ROWS, queryId, readOnly: config.readOnly })` (drop the `${config.id}:${started}` generation).
- [ ] **Step 5:** `src/main/ipc.ts` — handler destructures `queryId` and forwards it.
- [ ] **Step 6:** `src/main/query-service.test.ts` — add `queryId: 'q1'`(etc.) to all four `runUserQuery` call sites.
- [ ] **Step 7:** Gate (`npm run typecheck && npm run lint && npm test`) → commit `feat: thread renderer-generated queryId through query.run for cancellation`.

## Task 2: Monaco (bundled) + editor wrapper

- [ ] **Step 1:** `npm install monaco-editor@^0.50.0`
- [ ] **Step 2:** Create `src/renderer/src/lib/monaco.ts`:
```ts
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Bundle workers locally (no CDN). JS/TS worker serves the mongo-shell 'javascript' mode.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    if (label === 'javascript' || label === 'typescript') return new TsWorker()
    return new EditorWorker()
  }
}

// Mongo shell input isn't a real JS program — no bogus "db is undefined" squiggles.
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false
})

monaco.editor.defineTheme('midnight', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '818cf8' },
    { token: 'string', foreground: '34d399' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'comment', foreground: '5b6478' }
  ],
  colors: {
    'editor.background': '#12151d',
    'editor.foreground': '#e3e7f0',
    'editor.lineHighlightBackground': '#1b1f2c80',
    'editorLineNumber.foreground': '#3a4056',
    'editorCursor.foreground': '#6366f1',
    'editor.selectionBackground': '#6366f133'
  }
})

export { monaco }
```
- [ ] **Step 3:** Create `src/renderer/src/components/MonacoEditor.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { monaco } from '../lib/monaco'

interface Props {
  initialValue: string
  language: string
  onChange: (text: string) => void
  onRun: () => void
}

/** Mount-once Monaco instance; parents remount it (via key) to replace content. */
export default function MonacoEditor({ initialValue, language, onChange, onRun }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const editor = monaco.editor.create(host, {
      value: initialValue,
      language,
      theme: 'midnight',
      minimap: { enabled: false },
      fontSize: 13,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      tabSize: 2
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current())
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))
    editor.focus()
    return () => {
      sub.dispose()
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design (remount via key)
  }, [])

  return <div className="editor-host" ref={hostRef} />
}
```
- [ ] **Step 4:** Gate (typecheck:web must resolve the `?worker` imports via vite/client types) → commit `feat: bundle Monaco locally with midnight theme and worker setup`.

## Task 3: Query tabs

- [ ] **Step 1:** Extend `src/renderer/src/state/store.ts` with a tabs slice (import `QueryResult` from `@shared/query`):
```ts
export interface QueryTabData {
  id: string
  connectionId: string
  title: string
  text: string
  /** Bumped when text is replaced programmatically (history load) to remount the editor. */
  epoch: number
  runOnOpen: boolean
  running: boolean
  queryId: string | null
  result: QueryResult | null
  error: string | null
}
```
State/actions: `tabs: QueryTabData[]`, `activeTabId: string | null`, `queryCounter` (for “Query N” titles); `openQueryTab(args: { connectionId: string; title?: string; text?: string; runOnOpen?: boolean })` (creates with `crypto.randomUUID()`, activates), `closeTab(id)` (activates a neighbor), `setActiveTab(id)`, `setTabText(id, text)`, `loadQueryText(id, text)` (sets text + `epoch++`), `startRun(id, queryId)` (running=true, error=null), `finishRun(id, payload: { result } | { error })` (running=false, queryId=null).
- [ ] **Step 2:** Create `src/renderer/src/lib/tabquery.ts`:
```ts
import type { ConnectionType } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'

const SIMPLE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Default query for double-clicking a table/collection in the tree. */
export function defaultTableQuery(type: ConnectionType, ref: ObjectRef): string {
  if (type === 'mongodb') {
    return SIMPLE.test(ref.name) ? `db.${ref.name}.find({})` : `db["${ref.name}"].find({})`
  }
  if (type === 'postgres') {
    return `SELECT * FROM "${ref.schema ?? 'public'}"."${ref.name}" LIMIT 100`
  }
  return `SELECT * FROM \`${ref.name}\` LIMIT 100`
}
```
- [ ] **Step 3:** Add to `src/renderer/src/lib/hooks.ts`: `useRunQuery` (mutation `({connectionId, query, queryId})` → `window.api.query.run(...)`, `onSettled` invalidates `['history', connectionId]`), `useCancelQuery` (`window.api.query.cancel(connectionId, queryId)`), `useHistory(connectionId)` (`['history', connectionId]` → `history.list(connectionId, 50)`, enabled when non-null, `retry: false`).
- [ ] **Step 4:** Create `TabBar.tsx`: row under the topbar listing tabs (connection color dot via `useConnections` lookup, title, × close that stops propagation) + a `+` button (new tab on the ACTIVE connection, title `Query ${n}`, disabled with tooltip when no active connection). Active tab styled.
- [ ] **Step 5:** Create `QueryTab.tsx` (receives `tab: QueryTabData`): toolbar = Run button (`▶ Run` / disabled while running) + Cancel (visible only while running) + connection chip (name, color, 🔒 when readOnly) + status (`{rowCount} rows · {durationMs} ms`, error text in red); `<MonacoEditor key={`${tab.id}:${tab.epoch}`} initialValue={tab.text} language={langFor(connection.type)} onChange={(t) => setTabText(tab.id, t)} onRun={run} />` where `langFor` = `'javascript'` for mongodb else `'sql'`; below, `<ResultsPanel tab={tab} />`. `run()` = guard non-empty text + not running → `const queryId = crypto.randomUUID()` → `startRun` → `mutateAsync` → `finishRun({result})` / catch `finishRun({error: message})`. Auto-run once on mount when `tab.runOnOpen` (then clear the flag via `startRun` path — use a `useEffect` with a ref guard). Cancel = `useCancelQuery` with the tab's live `queryId`.
- [ ] **Step 6:** Integrate: `App.tsx` main area renders `tabs.length ? (<><TabBar /><QueryTab key={activeTabId} tab={activeTab} /></>) : <Welcome />`. Update `Welcome` connected-state copy to “Double-click a table to query it, or open a new query tab.” `ObjectTree.tsx`: `onDoubleClick` on an object row → `openQueryTab({ connectionId, title: ref.name, text: defaultTableQuery(type, ref), runOnOpen: true })`. Fix the 4a nit in `TopBar.tsx` (`import type { ChangeEvent } from 'react'`).
- [ ] **Step 7:** Styles: `.tabbar`, `.tab`, `.tab.active`, `.tab-close`, `.tab-add`, `.querytab` (column flex), `.qt-toolbar`, `.qt-status`(.err), `.conn-chip`, `.editor-host` (flex: 0 0 42%, min-height 160px, border-bottom).
- [ ] **Step 8:** Gate → commit `feat: query tabs with Monaco editor, run/cancel, and table double-click`.

## Task 4: Results panel (grid · documents · export)

- [ ] **Step 1:** `npm install @tanstack/react-table@^8.20.5 @tanstack/react-virtual@^3.10.8`
- [ ] **Step 2:** Create `src/renderer/src/lib/export.ts`:
```ts
import type { ColumnMeta, QueryResult } from '@shared/query'

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCsv(columns: ColumnMeta[], rows: unknown[][]): string {
  return [columns.map((c) => csvEscape(c.name)).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

export function toJsonText(result: QueryResult): string {
  if (result.documents) return JSON.stringify(result.documents, null, 2)
  const objects = result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c.name, r[i]])))
  return JSON.stringify(objects, null, 2)
}

export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```
- [ ] **Step 3:** Create `ResultsGrid.tsx` — TanStack Table over `rows: unknown[][]` (`accessorFn: (row) => row[i]`, header = column name + sort indicator, `getCoreRowModel`+`getSortedRowModel`+`getFilteredRowModel`, global filter `includesString`), TanStack Virtual for rows (`estimateSize: () => 26`, overscan 10, absolute-positioned `.grid-row`s inside a relative spacer; sticky `.grid-head`); `gridTemplateColumns: repeat(n, minmax(140px, 1fr))` shared by head and rows (horizontal scroll when wide); cell format: `null`→`<span className="cell-null">NULL</span>`, object→`JSON.stringify`, else `String`; cells truncate with ellipsis + `title`; **double-click a cell copies its text** (`navigator.clipboard.writeText`).
- [ ] **Step 4:** Create `DocumentView.tsx` — dependency-free JSON tree over `result.documents` using native `<details>/<summary>` (objects/arrays collapsible, `open` at depth 0; keys `.json-key`, primitives typed classes `.json-string/.json-number/.json-bool/.json-null`; arrays show `[n]` counts, monospace).
- [ ] **Step 5:** Create `ResultsPanel.tsx` (receives the tab): empty state (“Run a query — ⌘↵”), running spinner state, error state (`.qt-error` block); on result: toolbar = view toggle segmented control **Table | Documents** (only when `result.documents !== null`, default **Documents** for mongo finds), global filter input (table view), `CSV`/`JSON` export buttons (`download('result.csv', toCsv(...), 'text/csv')` etc.), truncated chip (`showing first {rows.length} of {rowCount}`) when `result.truncated`; body = `ResultsGrid` or `DocumentView`.
- [ ] **Step 6:** Styles: `.results`, `.results-toolbar`, `.seg`/`.seg-btn(.active)`, `.filter-input`, `.chip-warn`, `.grid-wrap/.grid-head/.grid-row(.odd)/.grid-cell/.cell-null`, `.doc-view`, `.json-*`, `.qt-error`, `.spinner`.
- [ ] **Step 7:** Gate → commit `feat: virtualized results grid, document tree view, CSV/JSON export`.

## Task 5: History

- [ ] **Step 1:** Create `HistorySection.tsx`: collapsible `<details className="history">` pinned under the object tree in the sidebar (sidebar becomes a column flex: tree scrolls, history collapses); lists `useHistory(activeConnectionId)` entries: ok/fail dot (`success`), first ~60 chars of the query (mono, ellipsis, full text in `title`), relative-ish time (`HH:MM`); click → if the active tab exists and is on this connection → `loadQueryText(activeTabId, entry.query)` else `openQueryTab({ connectionId, title: 'History', text: entry.query })`.
- [ ] **Step 2:** Wire into `App.tsx` sidebar below `<ObjectTree />`. Styles: `.history`, `.history-item`, `.h-dot(.ok/.fail)`, `.h-text`, `.h-time`.
- [ ] **Step 3:** Gate → commit `feat: query history panel (re-run from sidebar)`.

## Task 6: Verification (controller-driven)

- [ ] Gates + `npm run test:integration` (12) still green.
- [ ] Live demo on `dbclient-demo` postgres: double-click `customers` → auto-run tab with grid; type a join + ⌘Enter; sort/filter/copy/export; history re-run; read-only toggle blocks an `INSERT` with a clear error. Optional quick Mongo container for the Documents view.

## Self-Review (plan author)

- **Spec slice:** Monaco SQL editor + Mongo (shell/JSON in one input, auto-detected by the 3e parser) ✓; run/cancel ✓ (queryId threaded T1); virtualized grid + sort/filter/copy/export ✓ T4; document tree ✓ T4; history click-to-re-run ✓ T5; tabs + double-click-table ✓ T3. Deferred to 4c: ⌘K, Settings, light theme. Deliberate: EJSON relaxed for documents (noted), tabs in-memory, run-at-cursor/multi-result-tabs later.
- **Placeholder scan:** grid/panel/history specified behaviorally with their key mechanics (accessorFn-by-index, virtualizer wiring, details-tree) — full code given for all non-visual logic (monaco env, wrapper, store shape, exports, tabquery, backend diffs).
- **Type consistency:** `QueryResult`/`ColumnMeta` from `@shared/query`; `queryId` required end-to-end; store actions match component usage.

## Definition of Done

Gates + integration green. Live: double-click a table → results appear; ⌘Enter runs; cancel button shows while running; grid sorts/filters/copies/exports; truncation chip on >1000 rows; history re-runs; read-only connection blocks a write with the guard's message. On green → **Plan 4c — palette, settings, polish, packaging**.
