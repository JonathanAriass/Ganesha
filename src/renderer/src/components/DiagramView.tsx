import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ColumnInfo } from '@shared/schema'
import { useObjects, useAllColumns, useRelationships } from '../lib/hooks'
import {
  inferRelationships,
  mergeRelationships,
  buildDiagram,
  nodeKey,
  neighborNodes,
} from '../lib/schema-diagram'
import { layoutDiagram, pointsToPath, fitView, HEADER_H, ROW_H, type LaidNode } from '../lib/diagram-layout'

function truncate(s: string, max = 28): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Read-only schema diagram for one connection: tables + columns laid out by dagre, declared FKs
 *  (solid) and inferred ones (dashed), on a pannable/zoomable SVG canvas. */
export default function DiagramView({ connectionId }: { connectionId: string }): JSX.Element {
  const objectsQ = useObjects(connectionId)
  const columnsQ = useAllColumns(connectionId)
  const relsQ = useRelationships(connectionId)

  const [filter, setFilter] = useState('')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<string | null>(null) // selected table → highlight its relations

  const containerRef = useRef<HTMLDivElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const view = useRef({ x: 0, y: 0, zoom: 1 })
  const pan = useRef<{ x: number; y: number; ox: number; oy: number; nodeId: string | null; moved: boolean } | null>(null)

  const columnsByTable = useMemo(() => {
    const m = new Map<string, ColumnInfo[]>()
    for (const t of columnsQ.data ?? []) m.set(nodeKey(t.schema, t.name), t.columns)
    return m
  }, [columnsQ.data])

  const laid = useMemo(() => {
    const objects = objectsQ.data
    if (!objects || !columnsQ.data) return null
    const inferred = inferRelationships(objects, columnsByTable)
    let rels = mergeRelationships(relsQ.data ?? [], inferred)
    if (!showInferred) rels = rels.filter((r) => r.origin === 'declared')
    return layoutDiagram(buildDiagram(objects, columnsByTable, rels))
  }, [objectsQ.data, columnsQ.data, relsQ.data, columnsByTable, showInferred])

  const applyView = useCallback(() => {
    const v = view.current
    gRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.zoom})`)
  }, [])

  const fit = useCallback(() => {
    if (!laid || !containerRef.current) return
    const r = containerRef.current.getBoundingClientRect()
    view.current = fitView(laid.width, laid.height, r.width, r.height)
    applyView()
  }, [laid, applyView])

  // Fit whenever a fresh layout appears (new connection / inferred toggle re-layout).
  useEffect(() => { fit() }, [fit])

  // Zoom toward the cursor. Native non-passive listener so preventDefault stops page scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      const v = view.current
      const z = Math.max(0.05, Math.min(v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 2.5))
      view.current = { x: cx - (cx - v.x) * (z / v.zoom), y: cy - (cy - v.y) * (z / v.zoom), zoom: z }
      applyView()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // `laid` is a trigger, not a value used here: the canvas div only mounts once data arrives, so
    // re-run when it does to attach the listener (the loading/error states render no canvas).
  }, [applyView, laid])

  function zoomBy(factor: number): void {
    const el = containerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.width / 2
    const cy = r.height / 2
    const v = view.current
    const z = Math.max(0.05, Math.min(v.zoom * factor, 2.5))
    view.current = { x: cx - (cx - v.x) * (z / v.zoom), y: cy - (cy - v.y) * (z / v.zoom), zoom: z }
    applyView()
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // Record the table under the pointer NOW — pointer capture redirects later events to the canvas.
    const nodeEl = (e.target as Element).closest?.('[data-node]')
    pan.current = {
      x: e.clientX, y: e.clientY, ox: view.current.x, oy: view.current.y,
      nodeId: nodeEl?.getAttribute('data-node') ?? null, moved: false
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const p = pan.current
    if (!p) return
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) p.moved = true
    view.current = { ...view.current, x: p.ox + (e.clientX - p.x), y: p.oy + (e.clientY - p.y) }
    applyView()
  }
  function endPan(): void {
    const p = pan.current
    pan.current = null
    // A click (no real drag) selects the clicked table (toggling), or clears on empty canvas.
    if (p && !p.moved) setSelected((cur) => (p.nodeId && p.nodeId !== cur ? p.nodeId : null))
  }

  const matched = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f || !laid) return null
    return new Set(laid.nodes.filter((n) => n.name.toLowerCase().includes(f)).map((n) => n.id))
  }, [filter, laid])

  // The selected table + its related tables — everything else dims while a table is selected.
  const related = useMemo(() => (selected && laid ? neighborNodes(laid.edges, selected) : null), [selected, laid])

  // Centre the first matching table when the filter changes.
  useEffect(() => {
    if (!matched || !laid || !containerRef.current) return
    const first = laid.nodes.find((n) => matched.has(n.id))
    if (!first) return
    const r = containerRef.current.getBoundingClientRect()
    const z = view.current.zoom
    view.current = {
      x: r.width / 2 - (first.x + first.width / 2) * z,
      y: r.height / 2 - (first.y + first.height / 2) * z,
      zoom: z,
    }
    applyView()
  }, [matched, laid, applyView])

  const loading = objectsQ.isLoading || columnsQ.isLoading || relsQ.isLoading
  const error = objectsQ.error || columnsQ.error || relsQ.error

  if (loading) return <div className="diagram-empty"><span className="spinner" /> Loading schema…</div>
  if (error) {
    return (
      <div className="diagram-empty">
        <p style={{ color: 'var(--danger-text)' }} role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }
  if (!laid || laid.nodes.length === 0) return <div className="diagram-empty">No tables to diagram.</div>

  return (
    <div className="diagram">
      <div className="diagram-toolbar">
        <input
          className="filter-input"
          placeholder="Find a table…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setFilter('') }}
        />
        <label className="checkbox-row">
          <input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
          Show inferred
        </label>
        <span className="diagram-legend">
          <span className="leg solid" /> FK <span className="leg dashed" /> inferred
        </span>
        <span className="spacer" style={{ marginLeft: 'auto' }} />
        <button className="btn ghost" onClick={fit} title="Fit to screen">Fit</button>
        <button className="btn ghost" onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</button>
        <button className="btn ghost" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">－</button>
      </div>
      <div
        className="diagram-canvas"
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <svg width="100%" height="100%">
          <defs>
            <marker id="diag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="diagram-arrow" />
            </marker>
          </defs>
          <g ref={gRef}>
            {laid.edges.map((e) => {
              const active = selected != null && (e.from === selected || e.to === selected)
              return (
                <path
                  key={e.id}
                  d={pointsToPath(e.points)}
                  className={`diagram-edge ${e.origin}${active ? ' active' : ''}${selected != null && !active ? ' faded' : ''}`}
                  markerEnd="url(#diag-arrow)"
                />
              )
            })}
            {laid.nodes.map((n) => (
              <NodeBox
                key={n.id}
                node={n}
                selected={n.id === selected}
                dimmed={(related != null && !related.has(n.id)) || (matched != null && !matched.has(n.id))}
              />
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}

function NodeBox({ node, selected, dimmed }: { node: LaidNode; selected: boolean; dimmed: boolean }): JSX.Element {
  return (
    <g
      data-node={node.id}
      transform={`translate(${node.x} ${node.y})`}
      className={`diagram-node${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
    >
      <rect width={node.width} height={node.height} rx={6} className="dn-box" />
      <rect width={node.width} height={HEADER_H} rx={6} className="dn-header" />
      <text x={9} y={HEADER_H / 2} className="dn-title" dominantBaseline="middle">{truncate(node.name)}</text>
      {node.columns.map((c, i) => (
        <text
          key={i}
          x={11}
          y={HEADER_H + i * ROW_H + ROW_H / 2}
          className={`dn-col${c.isPk ? ' pk' : ''}${c.isFk ? ' fk' : ''}`}
          dominantBaseline="middle"
        >
          {c.isPk ? '⚷ ' : c.isFk ? '↗ ' : ''}{truncate(c.name, 26)}
        </text>
      ))}
    </g>
  )
}
