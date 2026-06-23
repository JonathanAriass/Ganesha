import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnInfo } from '@shared/schema'
import { useObjects, useAllColumns, useRelationships } from '../lib/hooks'
import {
  inferRelationships,
  mergeRelationships,
  buildDiagram,
  nodeKey,
  neighborNodes,
  subDiagram,
  type Diagram,
} from '../lib/schema-diagram'
import { layoutDiagram, type LaidNode } from '../lib/diagram-layout'
import DiagramCanvas from './DiagramCanvas'

/** Read-only schema diagram for one connection: tables + columns laid out by dagre, declared FKs
 *  (solid) and inferred ones (dashed). Click a table to highlight its relations on the canvas AND
 *  open a split panel with the focused sub-diagram (just that table + its related tables). */
export default function DiagramView({ connectionId }: { connectionId: string }): JSX.Element {
  const objectsQ = useObjects(connectionId)
  const columnsQ = useAllColumns(connectionId)
  const relsQ = useRelationships(connectionId)

  const [filter, setFilter] = useState('')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [centerTarget, setCenterTarget] = useState<string | null>(null)

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
  const nameOf = useCallback((id: string) => laid?.nodes.find((n) => n.id === id)?.name ?? id, [laid])
  // A selection that survives a re-layout (filter/inferred toggle) but vanished from the graph is cleared.
  const selectedValid = selected != null && laid != null && laid.nodes.some((n) => n.id === selected)

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
        {matched != null && (
          <DiagramMatchList
            nodes={[...laid.nodes].filter((n) => matched.has(n.id)).sort((a, b) => a.name.localeCompare(b.name))}
            selected={selected}
            onPick={(id) => { setCenterTarget(id); setSelected(id) }}
          />
        )}
        <DiagramCanvas
          laid={laid}
          centerId={centerTarget}
          // A selection dims by its neighbours; otherwise the filter dims by its matches (one at a time).
          dimNode={(id) => (related != null ? !related.has(id) : matched != null && !matched.has(id))}
          nodeClass={(id) => (id === selected ? 'selected' : '')}
          edgeClass={(e) => {
            const active = selected != null && (e.from === selected || e.to === selected)
            return active ? 'active' : selected != null ? 'faded' : ''
          }}
          onSelect={(id) => setSelected((cur) => (id && id !== cur ? id : null))}
        />

        {selectedValid && selected && (
          <FocusPanel
            diagram={diagram}
            focusId={selected}
            nameOf={nameOf}
            onSelect={(id) => setSelected(id)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

/** The search-results list (left): tables matching the filter. Clicking one centres + selects it. */
function DiagramMatchList({
  nodes,
  selected,
  onPick,
}: {
  nodes: LaidNode[]
  selected: string | null
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <div className="diagram-matches">
      <div className="dm-head">{nodes.length} match{nodes.length === 1 ? '' : 'es'}</div>
      <div className="dm-body">
        {nodes.length === 0 && <div className="dm-empty">No tables match.</div>}
        {nodes.map((n) => (
          <button
            key={n.id}
            className={`dm-row${n.id === selected ? ' active' : ''}`}
            onClick={() => onPick(n.id)}
            title={`Go to ${n.name}`}
          >
            {n.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The split panel: a focused sub-diagram of the selected table + only its related tables. Clicking a
 *  table inside re-focuses (driving the parent selection, so the main canvas highlight follows). */
function FocusPanel({
  diagram,
  focusId,
  nameOf,
  onSelect,
  onClose,
}: {
  diagram: Diagram
  focusId: string
  nameOf: (id: string) => string
  onSelect: (id: string) => void
  onClose: () => void
}): JSX.Element {
  const sub = useMemo(() => layoutDiagram(subDiagram(diagram, focusId)), [diagram, focusId])
  const count = sub.nodes.length - 1
  return (
    <div className="diagram-focus">
      <div className="df-head">
        <span className="df-title" title={nameOf(focusId)}>◇ {nameOf(focusId)}</span>
        <span className="df-sub">{count} related table{count === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button className="btn ghost" onClick={onClose} aria-label="Close focused view">×</button>
      </div>
      <DiagramCanvas
        laid={sub}
        centerId={null}
        nodeClass={(id) => (id === focusId ? 'selected' : '')}
        onSelect={(id) => { if (id) onSelect(id) }}
      />
    </div>
  )
}
