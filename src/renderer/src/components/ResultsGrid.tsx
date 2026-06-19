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
import { cellText, cellMatchesFilter } from '../lib/grid-text'
import { buildGridTemplate, gridMinWidth, clampColumnWidth, autoFitWidth } from '../lib/column-size'
import { editKey } from '../lib/doc-path'
import { coerceMongoEditValue } from '../lib/mongo-edit-value'
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
  /** Staged edits for this tab (store-owned, keyed `row<SEP>path`). */
  edits?: Record<string, unknown>
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
  edits = {},
}: Props): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])

  // Row inspector selection. The id is the TanStack row id — the ORIGINAL data
  // index — so the selection follows its row through re-sorts and filters. The
  // rows reference is captured alongside it: when a new result lands, the pair
  // no longer matches and the selection self-invalidates (no effect needed).
  const [sel, setSel] = useState<{ rows: unknown[][]; id: string } | null>(null)
  if (sel !== null && sel.rows !== rows) setSel(null)
  const selId = sel !== null && sel.rows === rows ? sel.id : null

  // Staged edits live in the store (so ⌘S / the commit bar can reach them and they
  // survive grid churn); `edits` is this tab's map. Only `editing` (which cell is open
  // for editing) is local; it self-invalidates when a new result replaces `rows`.
  const [editing, setEditing] = useState<{ rowIndex: number; colIndex: number } | null>(null)
  const rowsRef = useRef(rows)
  if (rowsRef.current !== rows) {
    rowsRef.current = rows
    if (editing) setEditing(null)
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

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, filterValue) =>
      cellMatchesFilter(row.getValue(columnId), String(filterValue)),
    getColumnCanGlobalFilter: () => true,
  })

  const parentRef = useRef<HTMLDivElement>(null)
  const tableRows = table.getRowModel().rows

  const selPos = selId === null ? -1 : tableRows.findIndex((r) => r.id === selId)
  const step = (delta: number): void => {
    const next = tableRows[selPos + delta]
    if (next) setSel({ rows, id: next.id })
  }

  // ── Editing helpers ──
  const colEditable = (colIndex: number): boolean => {
    if (readOnly || !editable) return false
    const src = editable.columnSources[colIndex]
    return src !== null && !editable.keyColumns.includes(src)
  }

  // A table cell's edit path is its column's field name (top-level); null for a
  // non-editable column (expression/join). Edits are keyed by `row<SEP>path` so the table
  // and the document tree share one staged change per field.
  const cellKey = (rowIndex: number, colIndex: number): string | null => {
    const path = editable?.columnSources[colIndex]
    return path ? editKey(rowIndex, path) : null
  }

  function stageCell(rowIndex: number, colIndex: number, value: unknown): void {
    const k = tabId && cellKey(rowIndex, colIndex)
    if (!tabId || !k) return
    // SQL binds the raw string (the server coerces); Mongo needs a typed value for $set.
    const stored = isMongo ? coerceMongoEditValue(value as string | null, rows[rowIndex][colIndex]) : value
    store().setCellEdit(tabId, k, stored)
    setEditing(null)
    if (!requireCommit) void store().commitEdits(tabId) // fast-commit: write immediately
  }

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
  })

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
    const texts = table.getRowModel().rows.map((r) => cellText((r.original as unknown[])[colIndex]))
    const w = autoFitWidth(columns[colIndex].name, texts, (s) => ctx.measureText(s).width)
    setWidths((prev) => ({ ...prev, [colIndex]: w }))
  }

  return (
    <div className="grid-area">
      <div className="grid-col">
        <div className="grid-wrap" ref={parentRef} style={wrapStyle}>
          {/* sticky header */}
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

          {/* virtualized rows */}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 'var(--grid-min)' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = tableRows[virtualRow.index]
              const rowIndex = Number(row.id)
              return (
                <div
                  key={row.id}
                  className={`grid-row${virtualRow.index % 2 === 1 ? ' odd' : ''}${row.id === selId ? ' selected' : ''}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={(e) => {
                    if (selTimer.current !== null) {
                      window.clearTimeout(selTimer.current)
                      selTimer.current = null
                    }
                    if (selId !== null) {
                      setSel({ rows, id: row.id })
                      return
                    }
                    if (e.detail !== 1) return // part of a double-click: leave the layout alone
                    const id = row.id
                    selTimer.current = window.setTimeout(() => {
                      selTimer.current = null
                      setSel({ rows, id })
                    }, 250)
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const colIndex = Number(cell.column.id)
                    const dk = cellKey(rowIndex, colIndex)
                    const isDirty = dk !== null && Object.prototype.hasOwnProperty.call(edits, dk)
                    const raw = isDirty ? edits[dk!] : cell.getValue()
                    const text = cellText(raw)
                    const isEditing = editing?.rowIndex === rowIndex && editing?.colIndex === colIndex
                    if (isEditing) {
                      return (
                        <EditingCell
                          key={cell.id}
                          initial={raw}
                          onCommit={(v) => stageCell(rowIndex, colIndex, v)}
                          onCancel={() => setEditing(null)}
                        />
                      )
                    }
                    const editableCell = colEditable(colIndex)
                    return (
                      <div
                        key={cell.id}
                        className={`grid-cell${isDirty ? ' cell-dirty' : ''}${editableCell ? ' editable' : ''}`}
                        title={text}
                        onDoubleClick={() => {
                          if (editableCell) setEditing({ rowIndex, colIndex })
                          else void window.api.clipboard.copy(text)
                        }}
                      >
                        {raw === null || raw === undefined ? (
                          <span className="cell-null">NULL</span>
                        ) : (
                          text
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
      </div>

      {selId !== null && (
        <RowInspector
          key={selId}
          columns={columns}
          row={rows[Number(selId)]}
          pos={selPos}
          total={tableRows.length}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  )
}
