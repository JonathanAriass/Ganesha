import { useState } from 'react'
import type { QueryTabData } from '../state/store'
import ResultsGrid from './ResultsGrid'
import DocumentView from './DocumentView'
import { toCsv, toJsonText, download } from '../lib/export'

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
        <div className="results-empty">Run a query — ⌘↵</div>
      </div>
    )
  }

  const result = tab.result

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
          {result.truncated && (
            <span className="chip-warn">
              showing first {result.rows.length} of {result.rowCount}
            </span>
          )}
          <button
            className="btn"
            title="Exports all rows (ignores the filter)"
            onClick={() => download('result.csv', toCsv(result.columns, result.rows), 'text/csv')}
          >
            CSV
          </button>
          <button
            className="btn"
            title="Exports all rows (ignores the filter)"
            onClick={() => download('result.json', toJsonText(result), 'application/json')}
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
