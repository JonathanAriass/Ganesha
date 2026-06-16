import { useEffect, useState } from 'react'
import type { DbObject } from '@shared/schema'
import { useAppStore } from '../state/store'
import { useObjects, useColumns, useConnections } from '../lib/hooks'
import { defaultTableQuery } from '../lib/tabquery'
import { filterObjects, substringMatch } from '../lib/object-filter'

// ── ObjectNode ────────────────────────────────────────────────────────────────

interface ObjectNodeProps {
  connectionId: string
  obj: DbObject
  query: string
  onDoubleClick: (obj: DbObject) => void
}

function ObjectNode({ connectionId, obj, query, onDoubleClick }: ObjectNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const ref = { schema: obj.schema, name: obj.name }

  const {
    data: columns,
    isLoading,
    error,
  } = useColumns(connectionId, ref, expanded)

  const kindLabel = obj.kind === 'table' ? 'T' : obj.kind === 'view' ? 'V' : 'C'

  return (
    <div className="tree-node">
      <button
        className="tree-row"
        onClick={(e) => {
          // Clicks that are part of a double-click would toggle twice before onDoubleClick fires.
          if (e.detail > 1) return
          setExpanded((ex) => !ex)
        }}
        onDoubleClick={() => onDoubleClick(obj)}
        aria-expanded={expanded}
      >
        <span className={`tree-caret${expanded ? ' open' : ''}`} aria-hidden="true">
          ▶
        </span>
        <span className={`obj-icon ${obj.kind}`} aria-hidden="true">
          {kindLabel}
        </span>
        <span className="tree-label">
          <Highlighted text={obj.name} positions={substringMatch(query, obj.name) ?? []} />
        </span>
      </button>

      {expanded && (
        <div className="tree-children">
          {isLoading && (
            <div className="tree-muted">Loading…</div>
          )}
          {error && !isLoading && (
            <div className="tree-error" role="alert">
              {error instanceof Error ? error.message : String(error)}
            </div>
          )}
          {!isLoading && !error && columns && columns.length === 0 && (
            <div className="tree-muted">no fields</div>
          )}
          {!isLoading && !error && columns && columns.map((col) => (
            <div key={col.name} className="tree-col">
              <span className="col-name">
                {col.name}
                {!col.nullable && (
                  <span className="col-type" style={{ marginLeft: 4 }}>
                    · not null
                  </span>
                )}
              </span>
              <span className="col-type">{col.dataType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Renders `text`, bolding the characters at `positions` (a substringMatch result). */
function Highlighted({ text, positions }: { text: string; positions: number[] }): JSX.Element {
  if (positions.length === 0) return <>{text}</>
  const set = new Set(positions)
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <b key={i} className="tree-match">
            {ch}
          </b>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  )
}

// ── ObjectTree ────────────────────────────────────────────────────────────────

export default function ObjectTree(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openQueryTab = useAppStore((s) => s.openQueryTab)

  const { data: connections = [] } = useConnections()
  const { data: objects, isLoading, error } = useObjects(activeConnectionId)

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  const [query, setQuery] = useState('')
  // Objects differ per connection — a stale filter would hide everything.
  useEffect(() => setQuery(''), [activeConnectionId])

  function handleDoubleClick(obj: DbObject) {
    if (!activeConnectionId || !activeConn) return
    const ref = { schema: obj.schema, name: obj.name }
    openQueryTab({
      connectionId: activeConnectionId,
      title: obj.name,
      text: defaultTableQuery(activeConn.type, ref),
      runOnOpen: true,
    })
  }

  if (!activeConnectionId) {
    return (
      <div className="sidebar-empty">
        <p>No connection selected.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="sidebar-empty">
        <p>Loading objects…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="sidebar-empty">
        <p style={{ color: 'var(--danger-text)' }} role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  if (!objects || objects.length === 0) {
    return (
      <div className="sidebar-empty">
        <p>No objects found.</p>
      </div>
    )
  }

  // Group by schema: if any object has a non-null schema, group them. Decided from
  // the ORIGINAL objects so the layout doesn't flip between grouped/flat while typing.
  const hasSchemas = objects.some((o) => o.schema !== null)
  const filtered = filterObjects(objects, query)

  const filterBar = (
    <div className="tree-filter">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
        }}
        placeholder="Filter tables…"
        aria-label="Filter database objects by name"
        spellCheck={false}
      />
      {query && (
        <button className="tree-filter-clear" onClick={() => setQuery('')} aria-label="Clear filter">
          ×
        </button>
      )}
    </div>
  )

  if (filtered.length === 0) {
    return (
      <nav className="tree" aria-label="Database objects">
        {filterBar}
        <div className="tree-muted">No tables match “{query}”</div>
      </nav>
    )
  }

  if (!hasSchemas) {
    return (
      <nav className="tree" aria-label="Database objects">
        {filterBar}
        {filtered.map((obj) => (
          <ObjectNode
            key={`${obj.schema ?? ''}:${obj.name}`}
            connectionId={activeConnectionId}
            obj={obj}
            query={query}
            onDoubleClick={handleDoubleClick}
          />
        ))}
      </nav>
    )
  }

  // Build groups preserving insertion order (over the FILTERED set, so empty
  // schema groups disappear).
  const groups = new Map<string, DbObject[]>()
  for (const obj of filtered) {
    const key = obj.schema ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(obj)
  }

  return (
    <nav className="tree" aria-label="Database objects">
      {filterBar}
      {Array.from(groups.entries()).map(([schema, objs]) => (
        <div key={schema}>
          {schema && (
            <div className="tree-schema" aria-label={`Schema: ${schema}`}>
              {schema}
            </div>
          )}
          {objs.map((obj) => (
            <ObjectNode
              key={`${obj.schema ?? ''}:${obj.name}`}
              connectionId={activeConnectionId}
              obj={obj}
              query={query}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </div>
      ))}
    </nav>
  )
}
