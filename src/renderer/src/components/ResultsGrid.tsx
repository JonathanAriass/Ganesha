import { useEffect, useMemo, useRef, useState } from 'react'
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
import { dirtyKey, buildRowEdits } from '../lib/edit-staging'
import { useAppStore } from '../state/store'
import { unwrap } from '../lib/result'
import RowInspector from './RowInspector'

interface Props {
  columns: ColumnMeta[]
  rows: unknown[][]
  globalFilter: string
  tabId?: string
  connectionId?: string
  /** When non-null, the result maps to one editable table — its cells can be edited. */
  editable?: EditableResult | null
  readOnly?: boolean
  /** ON → edits stage until an explicit Commit; OFF → Enter writes the cell immediately. */
  requireCommit?: boolean
}

/** A cell in edit mode: a text input over the cell. Commits exactly once (Enter, blur,
 *  or NULL) — the `done` guard stops the Enter→unmount→blur path firing twice. */
function EditingCell({
  initial,
  onCommit,
  onCancel,
}: {
  initial: unknown
  onCommit: (value: unknown) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(initial === null || initial === undefined ? '' : String(initial))
  const done = useRef(false)
  const commit = (value: unknown): void => {
    if (done.current) return
    done.current = true
    onCommit(value)
  }
  return (
    <div
      className="grid-cell editing"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
          else if (e.key === 'Escape') {
            done.current = true // suppress the blur-commit that the unmount triggers
            onCancel()
          }
        }}
        onBlur={() => commit(text)}
      />
      <button
        className="cell-null-btn"
        title="Set NULL"
        // mousedown + preventDefault keeps the input focused so its blur doesn't beat us.
        onMouseDown={(e) => {
          e.preventDefault()
          commit(null)
        }}
      >
        ∅
      </button>
    </div>
  )
}

export default function ResultsGrid({
  columns,
  rows,
  globalFilter,
  tabId,
  connectionId,
  editable,
  readOnly,
  requireCommit,
}: Props): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])

  // Row inspector selection. The id is the TanStack row id — the ORIGINAL data
  // index — so the selection follows its row through re-sorts and filters. The
  // rows reference is captured alongside it: when a new result lands, the pair
  // no longer matches and the selection self-invalidates (no effect needed).
  const [sel, setSel] = useState<{ rows: unknown[][]; id: string } | null>(null)
  if (sel !== null && sel.rows !== rows) setSel(null)
  const selId = sel !== null && sel.rows === rows ? sel.id : null

  // Staged cell edits keyed `rowId:colIndex`. Like the selection, they belong to the
  // current rows reference and self-invalidate when a new result (or a committed edit)
  // replaces it.
  const [dirty, setDirty] = useState<Map<string, unknown>>(new Map())
  const [editing, setEditing] = useState<{ rowIndex: number; colIndex: number } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const dirtyRowsRef = useRef(rows)
  if (dirtyRowsRef.current !== rows) {
    dirtyRowsRef.current = rows
    if (dirty.size) setDirty(new Map())
    if (editing) setEditing(null)
    if (editError) setEditError(null)
  }

  // Pending deferred panel-open (see the row onClick); cleared on unmount.
  const selTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (selTimer.current !== null) window.clearTimeout(selTimer.current)
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

  async function commit(map: Map<string, unknown>): Promise<void> {
    if (!editable || !connectionId || !tabId || map.size === 0) return
    try {
      await window.api.edits
        .apply({ connectionId, table: editable.table, rows: buildRowEdits(map, rows, editable) })
        .then(unwrap)
      const applied = [...map].map(([k, value]) => {
        const [rowIndex, colIndex] = k.split(':').map(Number)
        return { rowIndex, colIndex, value }
      })
      useAppStore.getState().applyResultEdits(tabId, applied)
      setDirty(new Map())
      setEditError(null)
    } catch (e) {
      // Leave the edits staged so the user can retry or discard.
      setEditError(e instanceof Error ? e.message : String(e))
    }
  }

  function stageCell(rowIndex: number, colIndex: number, value: unknown): void {
    const next = new Map(dirty)
    next.set(dirtyKey(rowIndex, colIndex), value)
    setDirty(next)
    setEditing(null)
    if (!requireCommit) void commit(next) // fast-commit: write immediately
  }

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
  })

  const gridTemplateColumns = `repeat(${columns.length}, minmax(140px, 1fr))`
  const minW = `${columns.length * 140}px`

  return (
    <div className="grid-area">
      <div className="grid-col">
        <div className="grid-wrap" ref={parentRef}>
          {/* sticky header */}
          <div className="grid-head" style={{ gridTemplateColumns, minWidth: minW }}>
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
                </div>
              )
            })}
          </div>

          {/* virtualized rows */}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: minW }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = tableRows[virtualRow.index]
              const rowIndex = Number(row.id)
              return (
                <div
                  key={row.id}
                  className={`grid-row${virtualRow.index % 2 === 1 ? ' odd' : ''}${row.id === selId ? ' selected' : ''}`}
                  style={{ gridTemplateColumns, transform: `translateY(${virtualRow.start}px)` }}
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
                    const dk = dirtyKey(rowIndex, colIndex)
                    const isDirty = dirty.has(dk)
                    const raw = isDirty ? dirty.get(dk) : cell.getValue()
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
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {requireCommit && (dirty.size > 0 || editError) && (
          <div className="edit-bar">
            <span>
              {dirty.size} pending change{dirty.size === 1 ? '' : 's'}
            </span>
            <button className="btn primary" disabled={dirty.size === 0} onClick={() => void commit(dirty)}>
              Commit
            </button>
            <button
              className="btn"
              onClick={() => {
                setDirty(new Map())
                setEditError(null)
              }}
            >
              Discard
            </button>
            {editError && (
              <span className="edit-error" role="alert">
                {editError}
              </span>
            )}
          </div>
        )}
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
