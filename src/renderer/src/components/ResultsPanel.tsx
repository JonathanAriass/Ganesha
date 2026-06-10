import type { QueryTabData } from '../state/store'

interface Props {
  tab: QueryTabData
}

export default function ResultsPanel({ tab }: Props): JSX.Element {
  if (tab.running) {
    return (
      <div className="results">
        <div className="results-empty">Running…</div>
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
  if (tab.result) {
    return (
      <div className="results">
        <div className="results-empty">{tab.result.rowCount} rows — grid coming next</div>
      </div>
    )
  }
  return (
    <div className="results">
      <div className="results-empty">Run a query — ⌘↵</div>
    </div>
  )
}
