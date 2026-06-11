import { useState } from 'react'
import type { QueryTabData } from '../state/store'
import ResultsGrid from './ResultsGrid'
import DocumentView from './DocumentView'
import { toCsv, toJsonText, toJsonObjects, download } from '../lib/export'
import { rowMatchesFilter } from '../lib/grid-text'
import { mod } from '../lib/platform'
import { truncationLabel } from '../lib/result-label'

interface Props {
  tab: QueryTabData
}

type View = 'table' | 'documents'

export default function ResultsPanel({ tab }: Props): JSX.Element {
  const hasDocuments = tab.result?.documents != null
  // Only the explicit user choice is state; the panel mounts before any result
  // exists, so the default must be derived at render time once one arrives.
  const [userView, setUserView] = useState<View | null>(null)
  const [filter, setFilter] = useState('')
  const view: View = userView ?? (hasDocuments ? 'documents' : 'table')

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
  const filtering = view === 'table' && filter !== ''

  // Export what the grid shows: the filtered subset when a table filter is active.
  function exportRows(): unknown[][] {
    return filtering ? result.rows.filter((r) => rowMatchesFilter(r, filter)) : result.rows
  }

  if (result.columns.length === 0) {
    return (
      <div className="results">
        <div className="results-empty">No rows</div>
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
          <input
            className="filter-input"
            placeholder="Filter rows…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
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
        <ResultsGrid columns={result.columns} rows={result.rows} globalFilter={filter} />
      ) : (
        <DocumentView documents={result.documents!} />
      )}
    </div>
  )
}
