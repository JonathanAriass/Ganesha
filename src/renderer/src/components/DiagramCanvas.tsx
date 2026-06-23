import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { pointsToPath, HEADER_H, ROW_H, fitView, type LaidDiagram, type LaidNode, type LaidEdge } from '../lib/diagram-layout'

function truncate(s: string, max = 28): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

interface Props {
  laid: LaidDiagram
  /** Extra class(es) for a node (e.g. `'selected'`). */
  nodeClass?: (id: string) => string
  /** Dim a node (everything but the focus when something is selected). */
  dimNode?: (id: string) => boolean
  /** Extra class(es) for an edge (e.g. `'active'` / `'faded'`). */
  edgeClass?: (e: LaidEdge) => string
  /** Clicking a table reports its id; clicking empty canvas reports null. */
  onSelect?: (id: string | null) => void
  /** When this changes to a node id, centre that node. */
  centerId?: string | null
}

/** The pannable/zoomable SVG canvas of a laid-out diagram — shared by the full schema view and the
 *  focused-table modal. Pan/zoom write the transform straight to the DOM (no per-frame React render);
 *  a click (no drag) is reported via onSelect. */
export default function DiagramCanvas({ laid, nodeClass, dimNode, edgeClass, onSelect, centerId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const view = useRef({ x: 0, y: 0, zoom: 1 })
  const pan = useRef<{ x: number; y: number; ox: number; oy: number; nodeId: string | null; moved: boolean } | null>(null)

  const applyView = useCallback(() => {
    const v = view.current
    gRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.zoom})`)
  }, [])

  const fit = useCallback(() => {
    if (!containerRef.current) return
    const r = containerRef.current.getBoundingClientRect()
    view.current = fitView(laid.width, laid.height, r.width, r.height)
    applyView()
  }, [laid, applyView])

  const centerOnId = useCallback((id: string) => {
    const n = laid.nodes.find((x) => x.id === id)
    if (!n || !containerRef.current) return
    const r = containerRef.current.getBoundingClientRect()
    const z = view.current.zoom
    view.current = { x: r.width / 2 - (n.x + n.width / 2) * z, y: r.height / 2 - (n.y + n.height / 2) * z, zoom: z }
    applyView()
  }, [laid, applyView])

  useEffect(() => { fit() }, [fit]) // fit on mount + when the layout changes
  useEffect(() => { if (centerId) centerOnId(centerId) }, [centerId, centerOnId])

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
  }, [applyView])

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
    if (p && !p.moved) onSelect?.(p.nodeId)
  }

  return (
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
          {laid.edges.map((e) => (
            <path
              key={e.id}
              d={pointsToPath(e.points)}
              className={`diagram-edge ${e.origin} ${edgeClass?.(e) ?? ''}`}
              markerEnd="url(#diag-arrow)"
            />
          ))}
          {laid.nodes.map((n) => (
            <NodeBox key={n.id} node={n} extraClass={nodeClass?.(n.id) ?? ''} dimmed={dimNode?.(n.id) ?? false} />
          ))}
        </g>
      </svg>
      {/* Keep button presses off the pan handler: its setPointerCapture would otherwise swallow the
          pointerup/click (the buttons would never fire, and the canvas would treat it as a deselect). */}
      <div className="diagram-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn ghost" onClick={fit} title="Fit to screen">Fit</button>
        <button className="btn ghost" onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</button>
        <button className="btn ghost" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">－</button>
      </div>
    </div>
  )
}

function NodeBox({ node, extraClass, dimmed }: { node: LaidNode; extraClass: string; dimmed: boolean }): JSX.Element {
  return (
    <g
      data-node={node.id}
      transform={`translate(${node.x} ${node.y})`}
      className={`diagram-node ${extraClass}${dimmed ? ' dimmed' : ''}`}
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
