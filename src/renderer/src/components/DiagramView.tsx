import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnInfo } from '@shared/schema'
import { useObjects, useAllColumns, useRelationships } from '../lib/hooks'
import {
  inferRelationships,
  mergeRelationships,
  buildDiagram,
  nodeKey,
  neighborNodes,
  nodeRelations,
  subDiagram,
  type Diagram,
  type DiagramRelation,
} from '../lib/schema-diagram'
import { layoutDiagram, type LaidNode } from '../lib/diagram-layout'
import DiagramCanvas from './DiagramCanvas'

/** Read-only schema diagram for one connection: tables + columns laid out by dagre, declared FKs
 *  (solid) and inferred ones (dashed). Click a table to highlight its relations and list them; the
 *  ⛶ button opens a focused modal of just that table + its related tables. */
export default function DiagramView({ connectionId }: { connectionId: string }): JSX.Element {
  const objectsQ = useObjects(connectionId)
  const columnsQ = useAllColumns(connectionId)
  const relsQ = useRelationships(connectionId)

  const [filter, setFilter] = useState('')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [centerTarget, setCenterTarget] = useState<string | null>(null)
  const [focusOpen, setFocusOpen] = useState(false)

  const columnsByTable = useMemo(() => {
    const m = new Map<string, ColumnInfo[]>()
    for (const t of columnsQ.data ?? []) m.set(nodeKey(t.schema, t.name), t.columns)
    return m
  }, [columnsQ.data])

  const diagram = useMemo<Diagram | null>(() => {
    const objects = objectsQ.data
    if (!objects || !columnsQ.data) return null
    const inferred = inferRelationships(objects, columnsByTable)
    let rels = mergeRelationships(relsQ.data ?? [], inferred)
    if (!showInferred) rels = rels.filter((r) => r.origin === 'declared')
    return buildDiagram(objects, columnsByTable, rels)
  }, [objectsQ.data, columnsQ.data, relsQ.data, columnsByTable, showInferred])

  const laid = useMemo(() => (diagram ? layoutDiagram(diagram) : null), [diagram])

  const matched = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f || !laid) return null
    return new Set(laid.nodes.filter((n) => n.name.toLowerCase().includes(f)).map((n) => n.id))
  }, [filter, laid])

  // Centre the first matching table as the filter changes.
  useEffect(() => {
    if (!matched || !laid) return
    const first = laid.nodes.find((n) => matched.has(n.id))
    if (first) setCenterTarget(first.id)
  }, [matched, laid])

  const related = useMemo(() => (selected && laid ? neighborNodes(laid.edges, selected) : null), [selected, laid])
  const selectedNode = useMemo(() => laid?.nodes.find((n) => n.id === selected) ?? null, [laid, selected])
  const relations = useMemo(() => (selected && laid ? nodeRelations(laid.edges, selected) : []), [selected, laid])
  const nameOf = useCallback((id: string) => laid?.nodes.find((n) => n.id === id)?.name ?? id, [laid])

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
  if (!laid || !diagram || laid.nodes.length === 0) return <div className="diagram-empty">No tables to diagram.</div>

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
      </div>

      <div className="diagram-main">
        <DiagramCanvas
          laid={laid}
          centerId={centerTarget}
          dimNode={(id) => (related != null && !related.has(id)) || (matched != null && !matched.has(id))}
          nodeClass={(id) => (id === selected ? 'selected' : '')}
          edgeClass={(e) => {
            const active = selected != null && (e.from === selected || e.to === selected)
            return active ? 'active' : selected != null ? 'faded' : ''
          }}
          onSelect={(id) => setSelected((cur) => (id && id !== cur ? id : null))}
        />

        {selectedNode && (
          <DiagramSidePanel
            node={selectedNode}
            relations={relations}
            nameOf={nameOf}
            onSelect={(id) => { setSelected(id); setCenterTarget(id) }}
            onFocus={() => setFocusOpen(true)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {focusOpen && selectedNode && selected && (
        <FocusDiagramModal diagram={diagram} initialId={selected} nameOf={nameOf} onClose={() => setFocusOpen(false)} />
      )}
    </div>
  )
}

function DiagramSidePanel({
  node,
  relations,
  nameOf,
  onSelect,
  onFocus,
  onClose,
}: {
  node: LaidNode
  relations: DiagramRelation[]
  nameOf: (id: string) => string
  onSelect: (id: string) => void
  onFocus: () => void
  onClose: () => void
}): JSX.Element {
  const refs = relations.filter((r) => r.direction === 'references')
  const refBy = relations.filter((r) => r.direction === 'referenced-by')
  const row = (r: DiagramRelation, i: number): JSX.Element => (
    <button key={i} className="ds-row" onClick={() => onSelect(r.otherId)} title={`Go to ${nameOf(r.otherId)}`}>
      <span className="ds-table">{nameOf(r.otherId)}</span>
      <span className="ds-col">{r.column}</span>
      {r.origin === 'inferred' && <span className="ds-inferred" title="Inferred from naming">~</span>}
    </button>
  )
  return (
    <div className="diagram-side">
      <div className="ds-head">
        <span className="ds-title" title={node.name}>{node.name}</span>
        <button className="btn ghost" onClick={onFocus} title="Open focused diagram of related tables" aria-label="Focused diagram">⛶</button>
        <button className="btn ghost" onClick={onClose} aria-label="Close panel">×</button>
      </div>
      <div className="ds-body">
        {relations.length === 0 && <div className="ds-empty">No related tables.</div>}
        {refs.length > 0 && (
          <div className="ds-section">
            <div className="ds-section-title">References ({refs.length})</div>
            {refs.map(row)}
          </div>
        )}
        {refBy.length > 0 && (
          <div className="ds-section">
            <div className="ds-section-title">Referenced by ({refBy.length})</div>
            {refBy.map(row)}
          </div>
        )}
      </div>
    </div>
  )
}

function FocusDiagramModal({
  diagram,
  initialId,
  nameOf,
  onClose,
}: {
  diagram: Diagram
  initialId: string
  nameOf: (id: string) => string
  onClose: () => void
}): JSX.Element {
  const [focusId, setFocusId] = useState(initialId)
  const sub = useMemo(() => layoutDiagram(subDiagram(diagram, focusId)), [diagram, focusId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal diagram-modal">
        <div className="modal-header">
          <h2>◇ {nameOf(focusId)} — related tables</h2>
          <span className="spacer" style={{ marginLeft: 'auto' }} />
          <button className="btn ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="diagram-modal-body">
          <DiagramCanvas
            laid={sub}
            centerId={null}
            nodeClass={(id) => (id === focusId ? 'selected' : '')}
            onSelect={(id) => { if (id) setFocusId(id) }}
          />
        </div>
      </div>
    </div>
  )
}
