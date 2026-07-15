import { useMemo } from 'react'
import JsonView from 'react18-json-view'
import 'react18-json-view/src/style.css'
import type { EditableResult } from '@shared/query'
import { jsonEditTarget, applyPendingEdits } from '../lib/json-edit'
import { editKey, getAtPath, isKeyPath } from '../lib/doc-path'
import { coerceLibraryEditValue } from '../lib/mongo-edit-value'
import { useAppStore } from '../state/store'

interface Props {
  documents: Record<string, unknown>[]
  tabId?: string
  /** Non-null when the result is editable (a find over one collection); enables leaf edits. */
  editable?: EditableResult | null
  readOnly?: boolean
  requireCommit?: boolean
  edits?: Record<string, unknown>
}

/** react18-json-view's onEdit payload (the bits we use). */
interface EditParams {
  newValue: unknown
  parentPath: (string | number)[]
  indexOrName: string | number
}

/** Most documents this view renders. react18-json-view isn't virtualized, so a huge array (the
 *  grid can now page up to tens of thousands of rows) would freeze it — cap the render and point
 *  to the Table view for paging through everything. */
const DOC_VIEW_CAP = 1000

/** Collapsible, syntax-highlighted JSON viewer for Mongo documents (themed to the app via
 *  CSS vars on `.json-view`). Documents collapse by default on large result sets for speed;
 *  scalar leaves are editable in place (double-click), staged through the same path-keyed
 *  pipeline as the table — `_id`, key columns and EJSON-wrapper internals stay read-only. */
export default function DocumentView({ documents, tabId, editable, readOnly, requireCommit, edits = {} }: Props): JSX.Element {
  const canEdit = !!editable && !readOnly && !!tabId
  const capped = documents.length > DOC_VIEW_CAP

  // The viewer mutates its `src` in place on edit — feed it a fresh deep clone (with staged
  // edits applied, so pending values show). Memoized: re-clones only when docs/edits change.
  // Rendering is capped for performance; the leading slice keeps row indexes (edit keys) valid.
  const src = useMemo(
    () => applyPendingEdits(structuredClone(capped ? documents.slice(0, DOC_VIEW_CAP) : documents), edits),
    [documents, edits, capped],
  )

  const onEdit = (params: EditParams): void => {
    if (!canEdit || !tabId || !editable) return
    const target = jsonEditTarget(params.parentPath, params.indexOrName)
    if (!target || isKeyPath(target.path, editable.keyColumns)) return // _id / key / wrapper internal
    const original = getAtPath(documents[target.rowIndex], target.path)
    // The library hands back an already-parsed value (a string field "42" arrives as 42);
    // re-bias it to the original field's type so a string stays a string.
    const value = coerceLibraryEditValue(params.newValue, original)
    useAppStore.getState().setCellEdit(tabId, editKey(target.rowIndex, target.path), value)
    if (!requireCommit) void useAppStore.getState().commitEdits(tabId)
  }

  return (
    <div className="doc-view">
      {capped && (
        <div className="doc-view-cap">
          Showing first {DOC_VIEW_CAP} of {documents.length} documents — switch to Table view to page through all rows.
        </div>
      )}
      <JsonView
        src={src}
        // Expanded by default (the user can still fold individual nodes via the chevrons).
        collapsed={false}
        // Don't chunk the document array into `[0 … 99]` range groups — show the documents.
        ignoreLargeArray
        displaySize="collapsed"
        enableClipboard
        editable={canEdit ? { edit: true, add: false, delete: false } : false}
        onEdit={canEdit ? (onEdit as (p: unknown) => void) : undefined}
        // Belt-and-braces affordance: never offer an edit pencil on an _id field (the
        // onEdit guard also refuses key columns — this just hides the pencil).
        customizeNode={({ indexOrName }: { indexOrName?: string | number; depth: number }) =>
          indexOrName === '_id' ? { edit: false } : undefined
        }
      />
    </div>
  )
}
