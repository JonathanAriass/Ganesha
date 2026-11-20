import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConnectionConfig } from '@shared/domain'
import { useAppStore } from '../state/store'
import { useConnections, useGroups, useCreateGroup, useConnectionActions } from '../lib/hooks'
import { groupSections, sidebarRows } from '../lib/connection-groups'
import { loadCollapsedGroups, saveCollapsedGroups } from '../lib/shell-prefs'
import { startImport } from '../lib/transfer-actions'
import EnvTag from './EnvTag'
import { Icon } from './icons'
import ScrollArrows from './ScrollArrows'

/** A popup menu at a fixed point, closed by any click or right-click outside it or by Escape
 *  (as TabContextMenu); focus moves to its first item when it opens. */
function MenuAt({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [])

  return (
    <div className="tab-menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div ref={menuRef} className="tab-menu" role="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/** The sidebar's upper zone: every connection, grouped as on the dashboard (groups
 *  collapse, persisted per machine). Click selects, double-click opens a query tab,
 *  right-click edits / duplicates / deletes. `home` / `collapse` are the sidebar's own
 *  header buttons (owned by Sidebar, which moves them when this zone hides). */
export default function SidebarConnections({ home, collapse }: { home: ReactNode; collapse: ReactNode }): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const openModal = useAppStore((s) => s.openModal)
  const setTransferModal = useAppStore((s) => s.setTransferModal)

  const { data: connections = [], isLoading, error: loadError } = useConnections()
  const { data: groups = [] } = useGroups()
  const createGroup = useCreateGroup()
  const actions = useConnectionActions()

  const [collapsed, setCollapsed] = useState(() => new Set(loadCollapsedGroups()))
  // The ⋯ menu; `name` turns non-null once "New group" swaps the items for the name input.
  const [menu, setMenu] = useState<{ x: number; y: number; name: string | null } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; connection: ConnectionConfig } | null>(null)
  // The last failure of an action started here (import, new group, duplicate, delete);
  // every new attempt clears it.
  const [error, setError] = useState<string | null>(null)

  function toggleGroup(id: string): void {
    const next = new Set(collapsed)
    if (!next.delete(id)) next.add(id)
    setCollapsed(next)
    // Only ids of groups that still exist, so deleted groups don't pile up in storage.
    saveCollapsedGroups([...next].filter((g) => groups.some((x) => x.id === g)))
  }

  function commitNewGroup(raw: string): void {
    const name = raw.trim()
    setMenu(null)
    if (!name) return // empty → just cancel (the backend rejects blanks too)
    setError(null)
    createGroup.mutate({ name, parentId: null }, { onError: (e) => setError(e instanceof Error ? e.message : String(e)) })
  }

  async function importConnections(): Promise<void> {
    setError(null)
    setError(await startImport())
  }

  const rows = sidebarRows(groupSections(groups, connections), collapsed)

  const connectionRow = (c: ConnectionConfig, depth: number): JSX.Element => (
    <button
      key={c.id}
      className={`sidebar-row${c.id === activeConnectionId ? ' active' : ''}`}
      style={{ ['--depth' as never]: depth }}
      aria-pressed={c.id === activeConnectionId}
      // detail guard (as on the dashboard cards): the first click of a double-click already
      // selected; the second must not re-fire before onDoubleClick opens the tab. 0 = keyboard.
      onClick={(e) => {
        if (e.detail <= 1) setActiveConnection(c.id)
      }}
      onDoubleClick={() => {
        setActiveConnection(c.id)
        openQueryTab({ connectionId: c.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setRowMenu({ x: e.clientX, y: e.clientY, connection: c })
      }}
    >
      <span className="conn-dot" style={{ background: c.color }} aria-hidden="true" />
      <span className="sidebar-name" title={c.name}>
        {c.name}
      </span>
      <EnvTag connection={c} />
      {c.readOnly && (
        <span className="sidebar-lock" role="img" aria-label="Read-only" title="Read-only">
          <Icon name="lock" size={12} />
        </span>
      )}
    </button>
  )

  return (
    <section className="sidebar-zone sidebar-connections" aria-label="Connections">
      <ScrollArrows target=".sidebar-list" />
      <div className="sidebar-head">
        <span className="sidebar-label">Connections</span>
        <span className="spacer" />
        {home}
        <button
          className="icon-btn"
          onClick={() => openModal({ mode: 'create' })}
          aria-label="New connection"
          data-tooltip="New connection"
          data-tip="right"
        >
          <Icon name="plus" />
        </button>
        <button
          className="icon-btn"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4, name: null })
          }}
          aria-label="More connection actions"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          data-tooltip="New group, import, export"
          data-tip="right"
        >
          <Icon name="more" />
        </button>
        {collapse}
      </div>

      <div className="sidebar-list">
        {isLoading && <p className="sidebar-note">Loading connections…</p>}
        {loadError && (
          <p className="sidebar-note error" role="alert">
            {loadError instanceof Error ? loadError.message : String(loadError)}
          </p>
        )}
        {rows.map((row) =>
          row.kind === 'connection' ? (
            connectionRow(row.connection, row.depth)
          ) : (
            <button
              key={`group:${row.group.id}`}
              className="sidebar-row sidebar-group"
              style={{ ['--depth' as never]: row.depth }}
              aria-expanded={!row.collapsed}
              onClick={() => toggleGroup(row.group.id)}
            >
              <Icon name={row.collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
              <span className="sidebar-name">{row.group.name}</span>
              <span className="sidebar-count">{row.count}</span>
            </button>
          )
        )}
      </div>

      {error && (
        <p className="sidebar-note error" role="alert">
          {error}
        </p>
      )}

      {menu && (
        <MenuAt x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.name === null ? (
            <>
              <button className="tab-menu-item" role="menuitem" onClick={() => setMenu({ ...menu, name: '' })}>
                New group
              </button>
              <button
                className="tab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void importConnections()
                }}
              >
                Import…
              </button>
              <button
                className="tab-menu-item"
                role="menuitem"
                disabled={connections.length === 0}
                onClick={() => {
                  setMenu(null)
                  setTransferModal({ mode: 'export', connections })
                }}
              >
                Export…
              </button>
            </>
          ) : (
            <input
              className="filter-input sidebar-menu-input"
              placeholder="Group name"
              aria-label="New group name"
              autoFocus
              value={menu.name}
              onChange={(e) => setMenu({ ...menu, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewGroup(menu.name ?? '')
                else if (e.key === 'Escape') setMenu(null)
              }}
              onBlur={() => setMenu(null)}
            />
          )}
        </MenuAt>
      )}

      {rowMenu && (
        <MenuAt x={rowMenu.x} y={rowMenu.y} onClose={() => setRowMenu(null)}>
          <button
            className="tab-menu-item"
            role="menuitem"
            onClick={() => {
              setRowMenu(null)
              openModal({ mode: 'edit', id: rowMenu.connection.id })
            }}
          >
            Edit
          </button>
          <button
            className="tab-menu-item"
            role="menuitem"
            disabled={actions.duplicating}
            onClick={() => {
              setRowMenu(null)
              setError(null)
              actions.duplicate(rowMenu.connection.id, { onError: setError })
            }}
          >
            Duplicate
          </button>
          <button
            className="tab-menu-item"
            role="menuitem"
            disabled={actions.removing}
            onClick={() => {
              setRowMenu(null)
              setError(null)
              actions.remove(rowMenu.connection, { onError: setError })
            }}
          >
            Delete
          </button>
        </MenuAt>
      )}
    </section>
  )
}
