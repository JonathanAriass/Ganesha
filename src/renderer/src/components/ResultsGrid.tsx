import { useEffect, useMemo, useRef } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useState } from 'react'
import type { ColumnMeta } from '@shared/query'
import { cellText, cellMatchesFilter } from '../lib/grid-text'
import RowInspector from './RowInspector'

interface Props {
  columns: ColumnMeta[]
  rows: unknown[][]
  globalFilter: string
}

export default function ResultsGrid({ columns, rows, globalFilter }: Props): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])

  // Row inspector selection. The id is the TanStack row id — the ORIGINAL data
  // index — so the selection follows its row through re-sorts and filters. The
  // rows reference is captured alongside it: when a new result lands, the pair
  // no longer matches and the selection self-invalidates (no effect needed).
  const [sel, setSel] = useState<{ rows: unknown[][]; id: string } | null>(null)
  // Render-phase reset (React's "adjusting state during render" pattern) so a
  // stale selection doesn't pin the previous result's rows in memory.
  if (sel !== null && sel.rows !== rows) setSel(null)
  const selId = sel !== null && sel.rows === rows ? sel.id : null

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
    // Filter on the same projection the cells render (objects stringify, not [object Object]).
    // Shared with the export path (rowMatchesFilter) so "export filtered" can't drift.
    globalFilterFn: (row, columnId, filterValue) =>
      cellMatchesFilter(row.getValue(columnId), String(filterValue)),
    // Default eligibility samples row 0 (string|number only) — would skip object-first
    // and sparse null-first columns, the norm for Mongo key-union results.
    getColumnCanGlobalFilter: () => true,
  })

  const parentRef = useRef<HTMLDivElement>(null)
  const tableRows = table.getRowModel().rows

  // Inspector navigation works in VIEW order (whatever sort/filter shows).
  const selPos = selId === null ? -1 : tableRows.findIndex((r) => r.id === selId)
  const step = (delta: number): void => {
    const next = tableRows[selPos + delta]
    if (next) setSel({ rows, id: next.id })
  }

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
  })

  const gridTemplateColumns = `repeat(${columns.length}, minmax(140px, 1fr))`
  // Header and row spacer must share a min width or rows resolve to the viewport
  // while the header scrolls to 140×N, drifting the columns apart.
  const minW = `${columns.length * 140}px`

  return (
    <div className="grid-area">
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
            return (
              <div
                key={row.id}
                className={`grid-row${virtualRow.index % 2 === 1 ? ' odd' : ''}${row.id === selId ? ' selected' : ''}`}
                style={{ gridTemplateColumns, transform: `translateY(${virtualRow.start}px)` }}
                // Click selects only — never toggles closed — and OPENING the panel
                // is deferred past the double-click window: the panel mounting
                // reflows the flexed grid, so clicks 1 and 2 of a double-click must
                // see the SAME layout or click 2 retargets and the cell's
                // double-click-copy silently grabs a neighboring cell's value.
                // With the panel already open nothing reflows — select immediately.
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
                    // 250ms is a deliberate trade: Chromium counts double-clicks for
                    // ~500ms, but charging 500ms to EVERY panel open (the primary
                    // interaction) isn't worth covering unusually slow double-clicks
                    // — and the panel visibly opening under the gesture is its own cue.
                  }, 250)
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const raw = cell.getValue()
                  const text = cellText(raw)
                  return (
                    <div
                      key={cell.id}
                      className="grid-cell"
                      title={text}
                      onDoubleClick={() => void window.api.clipboard.copy(text)}
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

      {selId !== null && (
        <RowInspector
          // Keyed by row: navigation remounts the panel, resetting its scroll.
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
