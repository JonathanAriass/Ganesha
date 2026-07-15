import { useMemo, useState } from 'react'
import JsonView from 'react18-json-view'
import 'react18-json-view/src/style.css'
import type { ColumnMeta, EditableResult } from '@shared/query'
import { fieldView, rowJson, positionLabel } from '../lib/inspect'
import { columnEditable, columnEditKey, editChangesValue } from '../lib/edit-staging'
import { coerceMongoEditValue, coerceLibraryEditValue } from '../lib/mongo-edit-value'
import { asJsonTree } from '../lib/json-field'
import { getAtPath, setAtPath } from '../lib/doc-path'
import { cellText } from '../lib/grid-text'
import { useAppStore } from '../state/store'
import EditingCell from './EditingCell'

/** react18-json-view's onEdit payload (the bits we use), same shape as DocumentView's. */
interface EditParams {
  newValue: unknown
  parentPath: (string | number)[]
  indexOrName: string | number
}

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
        // JSON containers render as an editable tree; the clone is stable per (row, edits) so the
        // viewer keeps its expand/collapse state and doesn't re-clone every render.
        const json = asJsonTree(value)
        return {
          key,
          dirty,
          canEdit: columnEditable(editable, readOnly, i),
          view: fieldView(value),
          json,
          jsonSrc: json ? structuredClone(json.tree) : null,
        }
      }),
    [columns, row, edits, editable, readOnly, rowIndex]
  )

  function stage(i: number, value: unknown): void {
    const key = fields[i].key
    if (!tabId || !key) return
    setEditing(null)
    const original = row[i]
    if (!editChangesValue(value, original)) {
      // No-op edit (or edited back to the original) — don't stage; drop any prior staged change.
      if (Object.prototype.hasOwnProperty.call(edits, key)) store().resetCellEdit(tabId, key)
      return
    }
    // SQL binds the raw string (the server coerces); Mongo needs a typed value for $set.
    const stored = isMongo ? coerceMongoEditValue(value as string | null, original) : value
    store().setCellEdit(tabId, key, stored)
    if (!requireCommit) void store().commitEdits(tabId) // fast-commit: write immediately
  }

  /** A leaf edit from the JSON tree: rebuild the WHOLE field value with the leaf changed and stage
   *  it at the field's column key. Keeps the value real JSON — object (Mongo/`jsonb`) or, for a
   *  `json`-as-text field, a re-serialized JSON string — instead of the flat string the one-line
   *  editor produced. */
  function stageJson(i: number, params: EditParams): void {
    const f = fields[i]
    if (!tabId || !f.key || !f.json) return
    const segs = [...params.parentPath, params.indexOrName].map(String)
    if (segs.some((s) => s.startsWith('$'))) return // inside an EJSON wrapper ({$oid}/{$date}) — can't $set
    const path = segs.join('.')
    // The viewer hands back an already-parsed leaf; re-bias it to the original leaf's type.
    const leaf = coerceLibraryEditValue(params.newValue, getAtPath(f.json.tree, path))
    const next = setAtPath(f.json.tree, path, leaf)
    const stored = f.json.wasString ? JSON.stringify(next) : next
    // Edited back to the original whole value → drop any staged change instead of staging a no-op.
    if (cellText(stored) === cellText(row[i])) {
      if (Object.prototype.hasOwnProperty.call(edits, f.key)) store().resetCellEdit(tabId, f.key)
      return
    }
    store().setCellEdit(tabId, f.key, stored)
    if (!requireCommit) void store().commitEdits(tabId)
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
              {f.json ? (
                // JSON container → editable tree (leaf edits keep it real JSON, not a string).
                <div className={`ri-json${f.dirty ? ' dirty' : ''}`}>
                  <JsonView
                    src={f.jsonSrc!}
                    collapsed={2}
                    ignoreLargeArray
                    displaySize="collapsed"
                    enableClipboard
                    editable={f.canEdit ? { edit: true, add: false, delete: false } : false}
                    onEdit={f.canEdit ? ((p: unknown) => stageJson(i, p as EditParams)) : undefined}
                  />
                </div>
              ) : editing === i ? (
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
