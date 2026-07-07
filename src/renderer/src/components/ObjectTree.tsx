import { useEffect, useState } from 'react'
import type { DbObject } from '@shared/schema'
import { useAppStore } from '../state/store'
import { useObjects, useColumns, useConnections } from '../lib/hooks'
import { defaultTableQuery } from '../lib/tabquery'
import { filterObjects, substringMatch } from '../lib/object-filter'
import { sortObjects, loadSortMode, saveSortMode, type SortMode } from '../lib/object-sort'

// ── ObjectNode ────────────────────────────────────────────────────────────────

interface ObjectNodeProps {
  connectionId: string
  obj: DbObject
  query: string
  onDoubleClick: (obj: DbObject) => void
  onContextMenu: (obj: DbObject, x: number, y: number) => void
  onInfo: (obj: DbObject) => void
}

function ObjectNode({ connectionId, obj, query, onDoubleClick, onContextMenu, onInfo }: ObjectNodeProps): JSX.Element {
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
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(obj, e.clientX, e.clientY)
        }}
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
        <span
          className="tree-info"
          role="button"
          aria-label={`Table info for ${obj.name}`}
          title="Table info"
          onClick={(e) => {
            e.stopPropagation()
            onInfo(obj)
          }}
        >
          ⓘ
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
  const openTableQuery = useAppStore((s) => s.openTableQuery)
  const openTableInfoTab = useAppStore((s) => s.openTableInfoTab)
  const [menu, setMenu] = useState<{ obj: DbObject; x: number; y: number } | null>(null)

  const { data: connections = [] } = useConnections()
  const { data: objects, isLoading, error } = useObjects(activeConnectionId)

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  const [query, setQuery] = useState('')
  // Objects differ per connection — a stale filter would hide everything.
  useEffect(() => setQuery(''), [activeConnectionId])

  // Sort order is a global preference (survives connection switches + restarts), not per-connection.
  const [sortMode, setSortMode] = useState<SortMode>(() => loadSortMode())
  function changeSort(mode: SortMode): void {
    setSortMode(mode)
    saveSortMode(mode)
  }

  function handleDoubleClick(obj: DbObject) {
    if (!activeConnectionId || !activeConn) return
    const ref = { schema: obj.schema, name: obj.name }
    openTableQuery({
      connectionId: activeConnectionId,
      title: obj.name,
      text: defaultTableQuery(activeConn.type, ref),
    })
  }

  function handleTableInfo(obj: DbObject) {
    if (activeConnectionId) openTableInfoTab(activeConnectionId, { schema: obj.schema, name: obj.name })
    setMenu(null)
  }

  // Right-click menu for a tree object. Position-fixed; the full-screen backdrop dismisses it.
  const menuEl = menu && (
    <div
      className="tab-menu-backdrop"
      onMouseDown={() => setMenu(null)}
      onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
    >
      <div className="tab-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
        <button className="tab-menu-item" role="menuitem" onClick={() => handleTableInfo(menu.obj)}>Table info</button>
        <button className="tab-menu-item" role="menuitem" onClick={() => { handleDoubleClick(menu.obj); setMenu(null) }}>Open query</button>
      </div>
    </div>
  )

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
  const filtered = filterObjects(sortObjects(objects, sortMode), query)

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
      <select
        className="tree-sort"
        value={sortMode}
        onChange={(e) => changeSort(e.target.value as SortMode)}
        aria-label="Sort tables"
        title="Sort tables"
      >
        <option value="number"># Number</option>
        <option value="name">A→Z name</option>
        <option value="full">A→Z full</option>
      </select>
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
            onContextMenu={(o, x, y) => setMenu({ obj: o, x, y })}
            onInfo={handleTableInfo}
          />
        ))}
        {menuEl}
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
              onContextMenu={(o, x, y) => setMenu({ obj: o, x, y })}
              onInfo={handleTableInfo}
            />
          ))}
        </div>
      ))}
      {menuEl}
    </nav>
  )
}
