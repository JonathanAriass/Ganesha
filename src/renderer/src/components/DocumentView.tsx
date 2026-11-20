import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import JsonView from 'react18-json-view'
import 'react18-json-view/src/style.css'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { EditableResult } from '@shared/query'
import { jsonEditTarget, applyPendingEdits } from '../lib/json-edit'
import { editKey, getAtPath, isKeyPath } from '../lib/doc-path'
import { coerceLibraryEditValue } from '../lib/mongo-edit-value'
import { shouldLoadMore } from '../lib/load-more'
import { useAppStore } from '../state/store'

interface Props {
  documents: Record<string, unknown>[]
  tabId?: string
  /** Non-null when the result is editable (a find over one collection); enables leaf edits. */
  editable?: EditableResult | null
  readOnly?: boolean
  requireCommit?: boolean
  edits?: Record<string, unknown>
  /** Paging, as in the table: more documents are fetched when the end comes into view. */
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

/** react18-json-view's onEdit payload (the bits we use). */
interface EditParams {
  newValue: unknown
  parentPath: (string | number)[]
  indexOrName: string | number
}

/** Height assumed for a document before it has been measured. */
const ESTIMATED_DOC_HEIGHT = 220

interface DocProps {
  doc: Record<string, unknown>
  index: number
  canEdit: boolean
  onEdit: (rowIndex: number, params: EditParams) => void
}

/** One document. Memoized: scrolling re-renders the list, but a document whose data did not
 *  change keeps its tree (and what the user folded in it). */
const Doc = memo(function Doc({ doc, index, canEdit, onEdit }: DocProps): JSX.Element {
  // The viewer mutates its `src` in place on edit — give it its own deep clone.
  const src = useMemo(() => structuredClone(doc), [doc])
  return (
    <div className="doc-item">
      <span className="doc-index" aria-hidden="true">{index + 1}</span>
      <JsonView
        src={src}
        // Expanded by default (the user can still fold individual nodes via the chevrons).
        collapsed={false}
        ignoreLargeArray
        displaySize="collapsed"
        enableClipboard
        editable={canEdit ? { edit: true, add: false, delete: false } : false}
        onEdit={canEdit ? ((p: unknown) => onEdit(index, p as EditParams)) : undefined}
        // Belt-and-braces affordance: never offer an edit pencil on an _id field (the
        // onEdit guard also refuses key columns — this just hides the pencil).
        customizeNode={({ indexOrName }: { indexOrName?: string | number; depth: number }) =>
          indexOrName === '_id' ? { edit: false } : undefined
        }
      />
    </div>
  )
})

/** Collapsible, syntax-highlighted JSON viewer for Mongo documents (themed to the app via
 *  CSS vars on `.json-view`). The list is virtualized: only the documents in view (plus a few
 *  around them) are in the DOM, each measured as it renders, so switching to this view or
 *  scrolling a large result costs the same as a small one. Scalar leaves are editable in
 *  place (double-click), staged through the same path-keyed pipeline as the table — `_id`,
 *  key columns and EJSON-wrapper internals stay read-only. */
export default function DocumentView({
  documents, tabId, editable, readOnly, requireCommit, edits = {}, hasMore, loadingMore, onLoadMore
}: Props): JSX.Element {
  const canEdit = !!editable && !readOnly && !!tabId

  // Staged edits applied for display. Untouched documents keep their reference, so their
  // memoized trees are not rebuilt when another document is edited.
  const shown = useMemo(() => applyPendingEdits(documents, edits), [documents, edits])

  // Read through a ref so the callback handed to every document stays the same function.
  const live = useRef({ documents, editable, canEdit, tabId, requireCommit })
  live.current = { documents, editable, canEdit, tabId, requireCommit }
  const onEdit = useCallback((rowIndex: number, params: EditParams): void => {
    const { documents, editable, canEdit, tabId, requireCommit } = live.current
    if (!canEdit || !tabId || !editable) return
    // Each document is its own viewer, so the path it reports starts inside the document.
    const target = jsonEditTarget([rowIndex, ...params.parentPath], params.indexOrName)
    if (!target || isKeyPath(target.path, editable.keyColumns)) return // _id / key / wrapper internal
    const original = getAtPath(documents[target.rowIndex], target.path)
    // The library hands back an already-parsed value (a string field "42" arrives as 42);
    // re-bias it to the original field's type so a string stays a string.
    const value = coerceLibraryEditValue(params.newValue, original)
    useAppStore.getState().setCellEdit(tabId, editKey(target.rowIndex, target.path), value)
    if (!requireCommit) void useAppStore.getState().commitEdits(tabId)
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_DOC_HEIGHT,
    overscan: 3,
  })
  const items = virtualizer.getVirtualItems()

  const lastIndex = items.length ? items[items.length - 1].index : -1
  useEffect(() => {
    if (onLoadMore && shouldLoadMore(lastIndex, shown.length, !!hasMore, !!loadingMore, 5)) onLoadMore()
  }, [lastIndex, shown.length, hasMore, loadingMore, onLoadMore])

  return (
    <div className="doc-view" ref={scrollRef}>
      <div className="doc-list" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((v) => (
          <div
            key={v.key}
            className="doc-slot"
            data-index={v.index}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${v.start}px)` }}
          >
            <Doc doc={shown[v.index]} index={v.index} canEdit={canEdit} onEdit={onEdit} />
          </div>
        ))}
      </div>
      {loadingMore && <div className="doc-loading">Loading more…</div>}
    </div>
  )
}
