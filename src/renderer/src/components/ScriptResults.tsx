import { useState } from 'react'
import type { ScriptRun, ScriptStatementResult } from '../state/store'
import ResultsGrid from './ResultsGrid'
import { rowCountLabel } from '../lib/result-label'

/** The statement's first non-empty line — often its `-- title` comment, which is
 *  exactly what to show. Statements are never empty (the splitter drops
 *  comment/whitespace-only chunks), but slice defensively anyway. */
function firstLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line) return line.length > 80 ? `${line.slice(0, 80)}…` : line
  }
  return text.slice(0, 80)
}

function Section({ entry, index }: { entry: ScriptStatementResult; index: number }): JSX.Element {
  const hasGrid = entry.result !== null && entry.result.columns.length > 0
  // Open state is per-section and user-owned after the initial default — a later
  // statement finishing must not pop a section the user closed back open.
  const [open, setOpen] = useState(entry.error !== null || hasGrid)

  const dot = entry.skipped ? ' skip' : entry.error !== null ? ' fail' : ' ok'
  const meta = entry.skipped
    ? 'skipped'
    : entry.error !== null
      ? 'failed'
      : entry.result
        ? `${rowCountLabel(entry.result)} · ${entry.result.durationMs} ms`
        : ''

  const body =
    entry.error !== null ? (
      <pre className="qt-error">{entry.error}</pre>
    ) : hasGrid ? (
      <div className="ss-grid">
        <ResultsGrid columns={entry.result!.columns} rows={entry.result!.rows} globalFilter="" />
      </div>
    ) : null

  return (
    <details
      className="script-stmt"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="ss-caret" aria-hidden="true">
          ▸
        </span>
        <span className={`h-dot${dot}`} />
        <code className="ss-text" title={entry.text}>
          {index + 1}. {firstLine(entry.text)}
        </code>
        <span className="ss-meta">{meta}</span>
      </summary>
      {body}
    </details>
  )
}

/** Stacked per-statement results for a Run-all script, rendered progressively
 *  while it executes. Sections with rows (or an error) start open; write/DDL
 *  statements collapse to their summary line. Filter/export live in the
 *  single-result panel — rerun one statement (⌘↵) for the full toolset. */
export default function ScriptResults({
  run,
  running
}: {
  run: ScriptRun
  running: boolean
}): JSX.Element {
  return (
    <div className="script-results">
      {run.entries.map((entry, i) => (
        // Entries only append, so the index is a stable key.
        <Section key={i} entry={entry} index={i} />
      ))}
      {running && (
        <div className="script-running">
          <span className="spinner" />
          Running statement {Math.min(run.entries.length + 1, run.total)} of {run.total}…
        </div>
      )}
    </div>
  )
}
