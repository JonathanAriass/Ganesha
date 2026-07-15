import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ColumnMeta, EditableResult } from '@shared/query'
import { cellText } from '../lib/grid-text'
import { displayCellText, cellMatchesDateAware, type DateKind } from '../lib/date-format'
import { buildGridTemplate, gridMinWidth, clampColumnWidth, autoFitWidth } from '../lib/column-size'
import { columnEditable, columnEditKey, editChangesValue } from '../lib/edit-staging'
import { coerceMongoEditValue } from '../lib/mongo-edit-value'
import { shouldLoadMore } from '../lib/load-more'
import { highlightSegments } from '../lib/highlight'
import { useAppStore } from '../state/store'
import EditingCell from './EditingCell'
import RowInspector from './RowInspector'

interface Props {
  columns: ColumnMeta[]
  rows: unknown[][]
  globalFilter: string
  tabId?: string
  /** When non-null, the result maps to one editable table — its cells can be edited. */
  editable?: EditableResult | null
  readOnly?: boolean
  /** ON → edits stage until an explicit Commit; OFF → Enter writes the cell immediately. */
  requireCommit?: boolean
  /** Mongo connection: edited text is coerced to a typed value (preserving the original
   *  field's type) before staging, since `$set` would otherwise store the raw string. */
  isMongo?: boolean
  /** Per-column date kind for DISPLAY formatting (null per column = not a date / non-SQL).
   *  Display-only: copy, export, editing, and the tooltip keep the raw value. */
  columnKinds?: (DateKind | null)[] | null
  /** Staged edits for this tab (store-owned, keyed `row<SEP>path`). */
  edits?: Record<string, unknown>
  /** More rows are cached in main past the loaded ones (scroll auto-loads them). */
  hasMore?: boolean
  /** A load-more fetch is in flight — shows the footer, suppresses re-triggers. */
  loadingMore?: boolean
  /** Fetch + append the next page. Called when scrolled near the end. */
  onLoadMore?: () => void
  /** Stable identity of the current result (the queryId). Selection/editing self-invalidate
   *  when it changes (new query) but survive row appends (same query, more rows). */
  resultKey?: string | null
  /** When the rows are a FILTERED subset, the original result index per displayed row — so edits
   *  key by the real index (stable across filter/clear). null = identity (rows[i] is result row i). */
  rowIndices?: number[] | null
  /** Show the per-column filter row under the header. */
  showFilterRow?: boolean
  /** Current per-column filter inputs (colIndex → raw input). */
  columnFilters?: Record<number, string>
  /** Set/clear a column's filter input. */
  onColumnFilter?: (column: number, value: string) => void
  /** When filtering, the terms to highlight in matched cells (+ the mode to match them). */
  highlight?: { terms: string[]; regex: boolean; caseSensitive: boolean; wholeWord: boolean } | null
  /** Total match count, for the "X / N" next/prev navigator (shown when highlighting). */
  matchTotal?: number
}

export default function ResultsGrid({
  columns,
  rows,
  globalFilter,
  tabId,
  editable,
  readOnly,
  requireCommit,
  isMongo,
  columnKinds,
  edits = {},
  hasMore,
  loadingMore,
  onLoadMore,
  resultKey,
  rowIndices,
  showFilterRow,
  columnFilters,
  onColumnFilter,
  highlight,
  matchTotal,
}: Props): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const selKey = resultKey ?? null

  // Row inspector selection. The id is the TanStack row id — the ORIGINAL data
  // index — so the selection follows its row through re-sorts and filters. The
  // rows reference is captured alongside it: when a new result lands, the pair
  // no longer matches and the selection self-invalidates (no effect needed).
  // Keyed by the RESULT identity (queryId), not the rows array: a scroll-append makes a new
  // rows array but keeps the same result, so the inspector selection must survive it. A new
  // query changes selKey and self-invalidates the selection.
  const [sel, setSel] = useState<{ key: string | null; id: string } | null>(null)
  if (sel !== null && sel.key !== selKey) setSel(null)
  const selId = sel !== null && sel.key === selKey ? sel.id : null

  // Staged edits live in the store (so ⌘S / the commit bar can reach them and they
  // survive grid churn); `edits` is this tab's map. Only `editing` (which cell is open
  // for editing) is local; it self-invalidates when a new result replaces `rows`.
  const [editing, setEditing] = useState<{ rowIndex: number; colIndex: number } | null>(null)
  // The current match for next/prev navigation (index into the displayed rows; -1 = none).
  const [matchCursor, setMatchCursor] = useState(-1)
  // Close an open cell editor + reset the match cursor when the RESULT/QUERY changes — not on a
  // scroll-append, which keeps the same result identity so an in-progress edit isn't dropped.
  const keyRef = useRef(selKey)
  if (keyRef.current !== selKey) {
    keyRef.current = selKey
    if (editing) setEditing(null)
    if (matchCursor !== -1) setMatchCursor(-1)
  }
  const store = useAppStore.getState

  // Per-column pixel widths for columns the user has resized/auto-fit; untouched columns keep
  // the flexible fill. Reset whenever the columns change (a new query → default layout).
  const [widths, setWidths] = useState<Record<number, number>>({})
  const colsRef = useRef(columns)
  if (colsRef.current !== columns) {
    colsRef.current = columns
    setWidths({})
  }
  const measureRef = useRef<CanvasRenderingContext2D | null>(null)
  const dragRef = useRef<{
    colIndex: number
    startW: number
    startX: number
    live: Record<number, number>
    moved: boolean
  } | null>(null)

  // Pending deferred panel-open (see the row onClick); cleared on unmount.
  const selTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (selTimer.current !== null) window.clearTimeout(selTimer.current)
      // Unmounted mid-drag: restore the body styles the drag set.
      if (dragRef.current) {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    },
    []
  )

  const columnDefs = useMemo<ColumnDef<unknown[]>[]>(
    () =>
      columns.map((c, i) => ({
        id: String(i),
        accessorFn: (row: unknown[]) => row[i],
        header: c.name,
      })),
    [columns],
  )

  // The DISPLAY date kind for a column (null = show raw). Defined before the table so the
  // filter closure can reach it.
  const kindOf = (colIndex: number): DateKind | null => columnKinds?.[colIndex] ?? null

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Date columns match either the raw or the formatted spelling (search what you see).
    globalFilterFn: (row, columnId, filterValue) =>
      cellMatchesDateAware(row.getValue(columnId), kindOf(Number(columnId)), String(filterValue)),
    getColumnCanGlobalFilter: () => true,
  })

  const parentRef = useRef<HTMLDivElement>(null)
  const tableRows = table.getRowModel().rows

  const selPos = selId === null ? -1 : tableRows.findIndex((r) => r.id === selId)
  const step = (delta: number): void => {
    const next = tableRows[selPos + delta]
    if (next) setSel({ key: selKey, id: next.id })
  }

  // ── Editing helpers (shared with the row inspector, so they agree on editability) ──
  const colEditable = (colIndex: number): boolean => columnEditable(editable, readOnly, colIndex)
  const cellKey = (rowIndex: number, colIndex: number): string | null => columnEditKey(editable, rowIndex, colIndex)

  // `rowIndex` is the ORIGINAL result index (for the staging key); `original` is the displayed
  // cell's un-staged value (passed in, since `rows` is position-indexed when filtered).
  function stageCell(rowIndex: number, colIndex: number, value: unknown, original: unknown): void {
    const k = tabId && cellKey(rowIndex, colIndex)
    if (!tabId || !k) return
    setEditing(null)
    if (!editChangesValue(value, original)) {
      // No-op edit (or edited back to the original) — don't stage; drop any prior staged change.
      if (Object.prototype.hasOwnProperty.call(edits, k)) store().resetCellEdit(tabId, k)
      return
    }
    // SQL binds the raw string (the server coerces); Mongo needs a typed value for $set.
    const stored = isMongo ? coerceMongoEditValue(value as string | null, original) : value
    store().setCellEdit(tabId, k, stored)
    if (!requireCommit) void store().commitEdits(tabId) // fast-commit: write immediately
  }

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
  })

  // Auto-load the next page when scrolled near the end. Skipped while a filter is active: the
  // filter only sees loaded rows, so paging to satisfy it would quietly pull the whole cap.
  const virtualItems = virtualizer.getVirtualItems()
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1].index : -1
  useEffect(() => {
    if (!globalFilter && onLoadMore && shouldLoadMore(lastIndex, tableRows.length, !!hasMore, !!loadingMore)) {
      onLoadMore()
    }
  }, [lastIndex, tableRows.length, hasMore, loadingMore, onLoadMore, globalFilter])

  // Next/prev match navigation: step the cursor through the (filtered) rows, scrolling it into view
  // and loading more when stepping past the loaded set.
  function goMatch(delta: number): void {
    if (tableRows.length === 0) return
    const from = matchCursor < 0 ? (delta > 0 ? -1 : tableRows.length) : matchCursor
    const next = Math.min(Math.max(from + delta, 0), tableRows.length - 1)
    if (next >= tableRows.length - 1 && hasMore) onLoadMore?.()
    setMatchCursor(next)
  }
  useEffect(() => {
    if (matchCursor >= 0 && matchCursor < tableRows.length) virtualizer.scrollToIndex(matchCursor, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the cursor moves
  }, [matchCursor])

  // The grid template + scroll min-width live in CSS variables on .grid-wrap, so the header
  // and every row pick them up via CSS — a drag updates one property on the node (below)
  // instead of re-rendering the virtualized grid each frame.
  const template = buildGridTemplate(columns.length, widths)
  const minW = gridMinWidth(columns.length, widths)
  const wrapStyle = { '--grid-cols': template, '--grid-min': `${minW}px` } as CSSProperties

  // Drag a header's right edge → set that column's px width. Uses pointer capture (like the
  // editor splitter), so the handle keeps receiving move/up events even outside it AND React
  // detaches them if the grid unmounts mid-drag — no stray window listeners. The live widths
  // ride in a ref; each move writes the CSS vars straight to .grid-wrap (every row follows via
  // CSS, no React render) and pointer-up commits to state. A click without a real drag (≤3px)
  // never commits — so double-click-to-auto-fit doesn't accidentally lock a column.
  function startResize(e: ReactPointerEvent<HTMLDivElement>, colIndex: number): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      colIndex,
      startW: (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width,
      startX: e.clientX,
      live: { ...widths },
      moved: false,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  function moveResize(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || Math.abs(e.clientX - d.startX) <= 3) return // ignore hover / click jitter
    d.moved = true
    d.live = { ...d.live, [d.colIndex]: clampColumnWidth(d.startW + (e.clientX - d.startX)) }
    const wrap = parentRef.current
    wrap?.style.setProperty('--grid-cols', buildGridTemplate(columns.length, d.live))
    wrap?.style.setProperty('--grid-min', `${gridMinWidth(columns.length, d.live)}px`)
  }

  function endResize(): void {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    if (d.moved) setWidths({ ...d.live }) // only a real drag commits a width
  }

  // Double-click the handle → fit the column to the widest loaded value (header + all loaded
  // rows; only loaded rows exist — the grid is virtualized). Measured with a canvas using the
  // grid's own font.
  function autoFit(colIndex: number): void {
    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d')
    const ctx = measureRef.current
    if (!ctx) return
    const sample = parentRef.current?.querySelector('.grid-cell') as HTMLElement | null
    ctx.font = (sample && getComputedStyle(sample).font) || '12.5px sans-serif'
    const texts = table.getRowModel().rows.map((r) => displayCellText((r.original as unknown[])[colIndex], kindOf(colIndex)))
    const w = autoFitWidth(columns[colIndex].name, texts, (s) => ctx.measureText(s).width)
    setWidths((prev) => ({ ...prev, [colIndex]: w }))
  }

  return (
    <div className="grid-area">
      <div className="grid-col">
        <div className="grid-wrap" ref={parentRef} style={wrapStyle}>
          {/* sticky header stack: column names + optional per-column filter row */}
          <div className="grid-header">
          <div className="grid-head">
            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const sorted = header.column.getIsSorted()
              return (
                <div
                  key={header.id}
                  className="grid-cell"
                  onClick={header.column.getToggleSortingHandler()}
                  title={header.column.columnDef.header as string}
                >
                  {header.column.columnDef.header as string}
                  {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                  <div
                    className="col-resizer"
                    title="Drag to resize · double-click to fit"
                    onPointerDown={(e) => startResize(e, Number(header.column.id))}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      autoFit(Number(header.column.id))
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )
            })}
          </div>

          {showFilterRow && (
            <div className="grid-filter-row">
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const colIndex = Number(header.column.id)
                return (
                  <div className="grid-cell" key={header.id}>
                    <input
                      className="col-filter-input"
                      value={columnFilters?.[colIndex] ?? ''}
                      placeholder="filter…"
                      title="e.g. >30 · =active · !=x · !foo · or plain text (contains)"
                      onChange={(e) => onColumnFilter?.(colIndex, e.target.value)}
                    />
                  </div>
                )
              })}
            </div>
          )}
          </div>

          {/* virtualized rows */}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 'var(--grid-min)' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = tableRows[virtualRow.index]
              const pos = Number(row.id) // position in the displayed (possibly filtered) rows
              const rowIndex = rowIndices ? rowIndices[pos] : pos // original result index (edit keys)
              return (
                <div
                  key={row.id}
                  className={`grid-row${virtualRow.index % 2 === 1 ? ' odd' : ''}${row.id === selId ? ' selected' : ''}${virtualRow.index === matchCursor ? ' match-current' : ''}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={(e) => {
                    if (selTimer.current !== null) {
                      window.clearTimeout(selTimer.current)
                      selTimer.current = null
                    }
                    if (selId !== null) {
                      setSel({ key: selKey, id: row.id })
                      return
                    }
                    if (e.detail !== 1) return // part of a double-click: leave the layout alone
                    const id = row.id
                    selTimer.current = window.setTimeout(() => {
                      selTimer.current = null
                      setSel({ key: selKey, id })
                    }, 250)
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const colIndex = Number(cell.column.id)
                    const dk = cellKey(rowIndex, colIndex)
                    const isDirty = dk !== null && Object.prototype.hasOwnProperty.call(edits, dk)
                    const raw = isDirty ? edits[dk!] : cell.getValue()
                    const rawText = cellText(raw) // raw value: copy + hover tooltip + edit
                    const display = displayCellText(raw, kindOf(colIndex)) // formatted for date columns
                    const isEditing = editing?.rowIndex === rowIndex && editing?.colIndex === colIndex
                    if (isEditing) {
                      return (
                        <EditingCell
                          key={cell.id}
                          initial={raw}
                          onCommit={(v) => stageCell(rowIndex, colIndex, v, cell.getValue())}
                          onCancel={() => setEditing(null)}
                        />
                      )
                    }
                    const editableCell = colEditable(colIndex)
                    return (
                      <div
                        key={cell.id}
                        className={`grid-cell${isDirty ? ' cell-dirty' : ''}${editableCell ? ' editable' : ''}`}
                        title={rawText}
                        onDoubleClick={() => {
                          if (editableCell) setEditing({ rowIndex, colIndex })
                          else void window.api.clipboard.copy(rawText)
                        }}
                      >
                        {raw === null || raw === undefined ? (
                          <span className="cell-null">NULL</span>
                        ) : highlight ? (
                          highlightSegments(display, highlight.terms, highlight).map((s, k) =>
                            s.hit ? (
                              <mark key={k} className="hl">
                                {s.text}
                              </mark>
                            ) : (
                              <span key={k}>{s.text}</span>
                            ),
                          )
                        ) : (
                          display
                        )}
                        {isDirty && tabId && (
                          // Per-cell reset: revert just this cell to its original value.
                          <button
                            className="cell-reset"
                            title="Reset this cell"
                            onClick={(e) => {
                              e.stopPropagation()
                              store().resetCellEdit(tabId, dk!)
                            }}
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
        {loadingMore && <div className="grid-loading-more">Loading more…</div>}
      </div>

      {highlight && matchTotal !== undefined && matchTotal > 0 && (
        <div className="match-nav">
          <button className="btn ghost" title="Previous match" onClick={() => goMatch(-1)}>
            ↑
          </button>
          <button className="btn ghost" title="Next match" onClick={() => goMatch(1)}>
            ↓
          </button>
          <span className="match-nav-count">
            {matchCursor >= 0 ? matchCursor + 1 : 0} / {matchTotal}
          </span>
        </div>
      )}

      {selId !== null && (
        <RowInspector
          key={selId}
          columns={columns}
          row={rows[Number(selId)]}
          rowIndex={rowIndices ? rowIndices[Number(selId)] : Number(selId)}
          pos={selPos}
          total={tableRows.length}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSel(null)}
          tabId={tabId}
          editable={editable}
          readOnly={readOnly}
          requireCommit={requireCommit}
          isMongo={isMongo}
          edits={edits}
        />
      )}
    </div>
  )
}
