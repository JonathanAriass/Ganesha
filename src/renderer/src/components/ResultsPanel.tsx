import { useCallback, useEffect, useState } from 'react'
import { useAppStore, type QueryTabData } from '../state/store'
import { filterKey, buildColumnFilters, type FilterQuery } from '@shared/query'
import { unwrap } from '../lib/result'
import { useConnections } from '../lib/hooks'
import ResultsGrid from './ResultsGrid'
import ScriptResults from './ScriptResults'
import DocumentView from './DocumentView'
import { toCsv, toJsonText, toJsonObjects, download } from '../lib/export'
import { dateColumnKind, type SqlDialect } from '../lib/date-format'
import { mod } from '../lib/platform'
import { truncationLabel, affectedRowsLabel } from '../lib/result-label'

interface Props {
  tab: QueryTabData
}

type View = 'table' | 'documents'

export default function ResultsPanel({ tab }: Props): JSX.Element {
  const hasDocuments = tab.result?.documents != null
  // Only the explicit user choice is state; the panel mounts before any result
  // exists, so the default must be derived at render time once one arrives.
  const [userView, setUserView] = useState<View | null>(null)
  const [showFilterRow, setShowFilterRow] = useState(false) // per-column filter row visibility
  const filter = tab.filter // store-owned so main-side filtering + paging coordinate
  const mode = tab.filterMode // case / whole-word / regex toggles
  const columnFilters = tab.columnFilters
  const columns = buildColumnFilters(columnFilters) // per-column constraints (parsed)
  const active = filter !== '' || columns.length > 0 // is any filter in effect?
  const view: View = userView ?? (hasDocuments ? 'documents' : 'table')
  const { data: connections = [] } = useConnections()
  const connection = connections.find((c) => c.id === tab.connectionId)
  const openTableInfoTab = useAppStore((s) => s.openTableInfoTab)
  const pendingEdits = Object.keys(tab.edits).length

  // Scroll load-more: page the ACTIVE view — the filtered matches when a filter is on, else the raw
  // result. Reads LIVE tab state (getState) so the callback identity is stable and a stale closure
  // can't double-fetch; the store's loadingMore flag serializes concurrent scroll triggers.
  const loadMore = useCallback(() => {
    const store = useAppStore.getState()
    const t = store.tabs.find((x) => x.id === tab.id)
    if (!t || !t.resultQueryId || t.loadingMore) return
    const cols = buildColumnFilters(t.columnFilters)
    if (t.filter || cols.length > 0) {
      if (!t.filterView || !t.filterView.hasMore) return
      const query: FilterQuery = { text: t.filter, ...t.filterMode, columns: cols }
      store.setLoadingMore(tab.id, true)
      void window.api.query
        .filter(t.resultQueryId, query, t.filterView.rows.length)
        .then(unwrap)
        .then((page) => store.appendFilterRows(tab.id, filterKey(query), page))
        .catch(() => store.setLoadingMore(tab.id, false))
    } else {
      if (!t.hasMore || !t.result) return
      store.setLoadingMore(tab.id, true)
      void window.api.query
        .fetchMore(t.resultQueryId, t.result.rows.length)
        .then(unwrap)
        .then((page) => store.appendRows(tab.id, page))
        .catch(() => store.setLoadingMore(tab.id, false))
    }
  }, [tab.id])

  // Apply the filter query (text + toggles + per-column) over the WHOLE cached result in main
  // (debounced). Clears the view when nothing is active. The store's race guard drops a response
  // whose query the user has since changed.
  const resultQueryId = tab.resultQueryId
  useEffect(() => {
    if (!resultQueryId) return
    const cols = buildColumnFilters(columnFilters)
    if (filter === '' && cols.length === 0) {
      useAppStore.getState().clearFilterView(tab.id)
      return
    }
    const query: FilterQuery = { text: filter, ...mode, columns: cols }
    const key = filterKey(query)
    const handle = setTimeout(() => {
      void window.api.query
        .filter(resultQueryId, query, 0)
        .then(unwrap)
        .then((page) => useAppStore.getState().applyFilterPage(tab.id, key, page))
        .catch(() => {})
    }, 200)
    return () => clearTimeout(handle)
    // `mode`/`columnFilters` are stable refs until they actually change (store keeps them otherwise).
  }, [filter, mode, columnFilters, resultQueryId, tab.id])

  // Before the running spinner: a script renders progressively while it executes.
  if (tab.scriptRun) {
    return (
      <div className="results">
        {/* Keyed by run: a new Run-all remounts every section structurally, so
            open/closed defaults reset without relying on an empty-entries render
            slipping in between consecutive runs. */}
        <ScriptResults key={tab.scriptRun.runId} run={tab.scriptRun} running={tab.running} />
      </div>
    )
  }

  if (tab.running) {
    return (
      <div className="results">
        <div className="results-empty">
          <span className="spinner" />
          Running…
        </div>
      </div>
    )
  }

  if (tab.error) {
    return (
      <div className="results">
        <pre className="qt-error">{tab.error}</pre>
      </div>
    )
  }

  if (!tab.result) {
    return (
      <div className="results">
        <div className="results-empty">Run a query — {mod}↵</div>
      </div>
    )
  }

  const result = tab.result
  const filtering = view === 'table' && active
  // The active view: filtered matches (loaded from main) when filtering, else the raw result. `fv`
  // is null during the brief debounce before the first matches arrive → the raw rows show meanwhile.
  const fv = filtering ? tab.filterView : null
  const shownRows = fv ? fv.rows : result.rows
  const shownIndices = fv ? fv.indices : null
  const shownHasMore = fv ? fv.hasMore : tab.hasMore

  // Day-first DISPLAY formatting for SQL date/time/timestamp columns (postgres OIDs / mysql
  // type codes). Per-column null = not a date (or a non-SQL connection) → the grid shows raw.
  const dialect: SqlDialect | null =
    connection?.type === 'postgres'
      ? 'postgres'
      : connection?.type === 'mysql' || connection?.type === 'mariadb'
        ? 'mysql'
        : null
  const columnKinds = dialect ? result.columns.map((c) => dateColumnKind(c.dataType, dialect)) : null

  // Export what the grid shows: the loaded matches when filtering, else the loaded rows.
  function exportRows(): unknown[][] {
    return shownRows
  }

  // A result with no columns is a write/command (UPDATE/INSERT/DELETE/DDL), never a
  // SELECT — a zero-row SELECT still carries its column headers and renders an empty
  // grid below. So report that it ran and how many rows it affected, not "No rows".
  if (result.columns.length === 0) {
    return (
      <div className="results">
        <div className="results-empty done">
          <div className="done-title">✓ Query executed successfully</div>
          <div className="done-sub">{affectedRowsLabel(result)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="results" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="results-toolbar">
        {hasDocuments && (
          <div className="seg">
            <button
              className={`seg-btn${view === 'table' ? ' active' : ''}`}
              onClick={() => setUserView('table')}
            >
              Table
            </button>
            <button
              className={`seg-btn${view === 'documents' ? ' active' : ''}`}
              onClick={() => setUserView('documents')}
            >
              Documents
            </button>
          </div>
        )}
        {view === 'table' && (
          <>
            <input
              className="filter-input"
              placeholder="Filter all rows…"
              value={filter}
              title={'Space = AND · OR · -term negates · "quoted phrase"'}
              onChange={(e) => useAppStore.getState().setFilter(tab.id, e.target.value)}
            />
            <div className="filter-toggles">
              <button
                className={`ft-toggle${mode.caseSensitive ? ' active' : ''}`}
                title="Match case" aria-pressed={mode.caseSensitive}
                onClick={() => useAppStore.getState().setFilterMode(tab.id, { caseSensitive: !mode.caseSensitive })}
              >
                Aa
              </button>
              <button
                className={`ft-toggle${mode.wholeWord ? ' active' : ''}`}
                title="Whole word" aria-pressed={mode.wholeWord}
                onClick={() => useAppStore.getState().setFilterMode(tab.id, { wholeWord: !mode.wholeWord, regex: false })}
              >
                \b
              </button>
              <button
                className={`ft-toggle${mode.regex ? ' active' : ''}`}
                title="Regular expression" aria-pressed={mode.regex}
                onClick={() => useAppStore.getState().setFilterMode(tab.id, { regex: !mode.regex, wholeWord: false })}
              >
                .*
              </button>
              <button
                className={`ft-toggle${showFilterRow || columns.length > 0 ? ' active' : ''}`}
                title="Per-column filters (filter row)" aria-pressed={showFilterRow}
                onClick={() => setShowFilterRow((v) => !v)}
              >
                ▤
              </button>
            </div>
            {filtering && (
              <span className={`filter-count${fv?.invalid ? ' err' : ''}`}>
                {!fv ? '…' : fv.invalid ? 'invalid regex' : `${fv.total} match${fv.total === 1 ? '' : 'es'}`}
              </span>
            )}
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {result.editable && (
            <button
              className="btn"
              title="Table info — columns, indexes, foreign keys"
              onClick={() => openTableInfoTab(tab.connectionId, result.editable!.table)}
            >
              ⓘ Info
            </button>
          )}
          {result.truncated && <span className="chip-warn">{truncationLabel(result)}</span>}
          <button
            className="btn"
            title={filtering ? 'Exports the filtered rows' : 'Exports all rows'}
            onClick={() => download('result.csv', toCsv(result.columns, exportRows()), 'text/csv')}
          >
            CSV
          </button>
          <button
            className="btn"
            title={filtering ? 'Exports the filtered rows' : 'Exports all rows'}
            onClick={() =>
              download(
                'result.json',
                // Filtered exports use the flat row shape — the filter operates on the
                // table projection, so a documents export couldn't honor it.
                filtering ? toJsonObjects(result.columns, exportRows()) : toJsonText(result),
                'application/json'
              )
            }
          >
            JSON
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <ResultsGrid
          columns={result.columns}
          rows={shownRows}
          rowIndices={shownIndices}
          globalFilter=""
          tabId={tab.id}
          editable={connection && !connection.readOnly ? result.editable : null}
          readOnly={connection?.readOnly ?? true}
          requireCommit={connection?.requireCommit ?? true}
          isMongo={connection?.type === 'mongodb'}
          columnKinds={columnKinds}
          edits={tab.edits}
          hasMore={shownHasMore}
          loadingMore={tab.loadingMore}
          onLoadMore={loadMore}
          resultKey={`${tab.resultQueryId ?? ''}|${filtering ? filterKey({ text: filter, ...mode, columns }) : ''}`}
          showFilterRow={showFilterRow}
          columnFilters={columnFilters}
          onColumnFilter={(col, val) => useAppStore.getState().setColumnFilter(tab.id, col, val)}
          highlight={
            fv && fv.highlight.length > 0
              ? { terms: fv.highlight, regex: mode.regex, caseSensitive: mode.caseSensitive, wholeWord: mode.wholeWord }
              : null
          }
          matchTotal={fv?.total}
        />
      ) : (
        <DocumentView
          documents={result.documents!}
          tabId={tab.id}
          editable={connection && !connection.readOnly ? result.editable : null}
          readOnly={connection?.readOnly ?? true}
          requireCommit={connection?.requireCommit ?? true}
          edits={tab.edits}
        />
      )}

      {/* Pending-edit commit bar — shown for both the table and document views, so an edit
          staged in either can be reviewed/committed. Only in require-commit mode. */}
      {connection?.requireCommit && (pendingEdits > 0 || tab.editError) && (
        <div className="edit-bar">
          <span>
            {pendingEdits} pending change{pendingEdits === 1 ? '' : 's'}
          </span>
          <button
            className="btn primary"
            disabled={pendingEdits === 0}
            onClick={() => useAppStore.getState().openCommitModal(tab.id)}
          >
            Commit… (⌘S)
          </button>
          <button className="btn" onClick={() => useAppStore.getState().discardEdits(tab.id)}>
            Discard
          </button>
          {tab.editError && (
            <span className="edit-error" role="alert">
              {tab.editError}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
