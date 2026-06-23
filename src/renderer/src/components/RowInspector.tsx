import { useMemo, useState } from 'react'
import type { ColumnMeta, EditableResult } from '@shared/query'
import { fieldView, rowJson, positionLabel } from '../lib/inspect'
import { columnEditable, columnEditKey } from '../lib/edit-staging'
import { coerceMongoEditValue } from '../lib/mongo-edit-value'
import { useAppStore } from '../state/store'
import EditingCell from './EditingCell'

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
  // ── Editing (optional; the panel is read-only when absent or the result isn't editable) ──
  /** ORIGINAL row index — keys staged edits so the inspector, grid and tree share one change. */
  rowIndex?: number
  tabId?: string
  editable?: EditableResult | null
  readOnly?: boolean
  requireCommit?: boolean
  isMongo?: boolean
  /** This tab's staged edits (store-owned, keyed `row<SEP>path`). */
  edits?: Record<string, unknown>
}

/** Docked panel showing every field of one grid row at full value — the fix for long JSON/text
 *  being illegible in ~140px columns. Editable fields can be edited in place (double-click), staging
 *  through the same store buffer as the grid/tree, so the shared commit bar / ⌘S picks them up. The
 *  owning grid supplies view-order navigation. */
export default function RowInspector({
  columns,
  row,
  pos,
  total,
  onPrev,
  onNext,
  onClose,
  rowIndex,
  tabId,
  editable,
  readOnly,
  requireCommit,
  isMongo,
  edits = {},
}: Props): JSX.Element {
  const store = useAppStore.getState
  const [editing, setEditing] = useState<number | null>(null) // which field's editor is open

  // Per-field view of the EFFECTIVE value (the staged edit if dirty, else the row's cell). Memoized:
  // the virtualizer re-renders the owning grid on every scroll frame, and re-projecting a multi-MB
  // JSON cell per frame is real jank. Deps are reference-stable until the row or its staged edits change.
  const fields = useMemo(
    () =>
      columns.map((_c, i) => {
        const key = rowIndex !== undefined ? columnEditKey(editable, rowIndex, i) : null
        const dirty = key !== null && Object.prototype.hasOwnProperty.call(edits, key)
        const value = dirty ? edits[key as string] : row[i]
        return { key, dirty, canEdit: columnEditable(editable, readOnly, i), view: fieldView(value) }
      }),
    [columns, row, edits, editable, readOnly, rowIndex]
  )

  function stage(i: number, value: unknown): void {
    const key = fields[i].key
    if (!tabId || !key) return
    // SQL binds the raw string (the server coerces); Mongo needs a typed value for $set.
    const stored = isMongo ? coerceMongoEditValue(value as string | null, row[i]) : value
    store().setCellEdit(tabId, key, stored)
    setEditing(null)
    if (!requireCommit) void store().commitEdits(tabId) // fast-commit: write immediately
  }

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
                {f.view.formatted && (
                  <span className="ri-chip" title="Pretty-printed for display — Copy gives the original text">
                    JSON
                  </span>
                )}
                {f.dirty && tabId && (
                  <button
                    className="ri-reset"
                    aria-label={`Reset ${c.name}`}
                    title="Reset this field"
                    onClick={() => store().resetCellEdit(tabId, f.key as string)}
                  >
                    ↺
                  </button>
                )}
                <button
                  className="ri-copy"
                  aria-label={`Copy ${c.name}`}
                  title="Copy value"
                  onClick={() => void window.api.clipboard.copy(f.view.copyText)}
                >
                  ⧉
                </button>
              </div>
              {editing === i ? (
                <EditingCell
                  initial={f.dirty ? edits[f.key as string] : row[i]}
                  onCommit={(v) => stage(i, v)}
                  onCancel={() => setEditing(null)}
                  className="ri-editing"
                />
              ) : (
                <div
                  className={`ri-value${f.dirty ? ' dirty' : ''}${f.canEdit ? ' editable' : ''}`}
                  title={f.canEdit ? 'Double-click to edit' : undefined}
                  onDoubleClick={() => {
                    if (f.canEdit) setEditing(i)
                  }}
                >
                  {f.view.isNull ? <span className="cell-null">NULL</span> : <pre className="ri-pre">{f.view.text}</pre>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
