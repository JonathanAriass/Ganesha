import { useMemo } from 'react'
import type { ColumnMeta } from '@shared/query'
import { fieldView, rowJson, positionLabel } from '../lib/inspect'

interface Props {
  columns: ColumnMeta[]
  row: unknown[]
  /** Index in the CURRENT view order (sorted/filtered); -1 = hidden by the filter. */
  pos: number
  /** Row count of the current view. */
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

/** Docked panel showing every field of one grid row at full value — the fix for
 *  long JSON/text being illegible in ~140px columns. Pure presentation; the
 *  owning grid supplies view-order navigation. */
export default function RowInspector({ columns, row, pos, total, onPrev, onNext, onClose }: Props): JSX.Element {
  // Memoized: the virtualizer re-renders the owning grid on every scroll frame,
  // and re-projecting a multi-MB JSON cell (parse + pretty-print) per frame is
  // real jank. Both deps are reference-stable until the inspected row changes.
  const fields = useMemo(() => columns.map((_c, i) => fieldView(row[i])), [columns, row])

  return (
    <div className="row-inspector">
      <div className="ri-head">
        <span className="ri-title">{positionLabel(pos, total)}</span>
        <button
          className="btn ghost"
          aria-label="Copy row as JSON"
          title="Copy row as JSON"
          onClick={() => void window.api.clipboard.copy(rowJson(columns, row))}
        >
          Copy row
        </button>
        <button className="btn ghost" aria-label="Previous row" disabled={pos <= 0} onClick={onPrev}>
          ↑
        </button>
        <button
          className="btn ghost"
          aria-label="Next row"
          disabled={pos === -1 || pos >= total - 1}
          onClick={onNext}
        >
          ↓
        </button>
        <button className="btn ghost" aria-label="Close inspector" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ri-body">
        {columns.map((c, i) => {
          const f = fields[i]
          return (
            // Index key: column names can duplicate (SELECT 1 AS a, 2 AS a).
            <div className="ri-field" key={i}>
              <div className="ri-name">
                <span title={c.name}>{c.name}</span>
                {f.formatted && (
                  <span className="ri-chip" title="Pretty-printed for display — Copy gives the original text">
                    JSON
                  </span>
                )}
                <button
                  className="ri-copy"
                  aria-label={`Copy ${c.name}`}
                  title="Copy value"
                  onClick={() => void window.api.clipboard.copy(f.copyText)}
                >
                  ⧉
                </button>
              </div>
              {f.isNull ? <div className="cell-null">NULL</div> : <pre className="ri-pre">{f.text}</pre>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
