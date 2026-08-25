import { useState, type DragEvent } from 'react'
import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'
import { useAppStore } from '../state/store'
import { useConnections, useGroups, useCreateGroup, useRenameGroup, useDeleteGroup, useSetConnectionGroup } from '../lib/hooks'
import { groupSections, CONN_MIME, type GroupSection } from '../lib/connection-groups'
import { mod } from '../lib/platform'

/** The empty-pane view, now a connections dashboard: every connection as a
 *  card (click = select, double-click = open a query tab, ✎ = edit), arranged
 *  in group sections (drag a card onto a section to move it), plus a dashed
 *  "New connection" card. The TopBar dropdown remains the quick picker;
 *  this is the visual overview. */
export default function Welcome(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const openModal = useAppStore((s) => s.openModal)

  const { data: connections, isLoading, error } = useConnections()
  const { data: groups, isLoading: groupsLoading, error: groupsError } = useGroups()

  const createGroup = useCreateGroup()
  const renameGroup = useRenameGroup()
  const deleteGroup = useDeleteGroup()
  const setGroup = useSetConnectionGroup()

  // ＋ New group inline form (null = collapsed, string = the draft name).
  const [newGroupName, setNewGroupName] = useState<string | null>(null)
  // Inline header rename (which group + the draft name).
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  // Right-click / ⋯ context menu on a group header.
  const [menu, setMenu] = useState<{ x: number; y: number; group: ConnectionGroup } | null>(null)
  // Section currently hovered by a card drag (key = group id or 'ungrouped').
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  if (isLoading || groupsLoading) {
    return (
      <div className="welcome">
        <p style={{ color: 'var(--text-2)' }}>Loading connections…</p>
      </div>
    )
  }

  if (error || groupsError) {
    const e = error ?? groupsError
    const msg = e instanceof Error ? e.message : String(e)
    return (
      <div className="welcome">
        <div className="error" role="alert">
          <strong>Failed to load connections</strong>
          <span>{msg}</span>
        </div>
      </div>
    )
  }

  if (!connections || connections.length === 0) {
    return (
      <div className="welcome">
        <h2>Welcome to Ganesha</h2>
        <p>Connect to a Postgres, MySQL, MariaDB, or MongoDB database to get started.</p>
        <button className="btn primary" onClick={() => openModal({ mode: 'create' })}>
          + New connection
        </button>
      </div>
    )
  }

  const sections = groupSections(groups ?? [], connections)
  const knownGroupIds = new Set((groups ?? []).map((g) => g.id))
  // No groups → the single ungrouped section renders headerless (pre-groups look)
  // and isn't a drop target — there is nowhere to move a card to.
  const hasGroups = (groups ?? []).length > 0
  // The ungrouped section is always last; empty means every connection is grouped.
  const ungroupedEmpty = sections[sections.length - 1].connections.length === 0

  // First mutation error wins for the inline notice; each clears on its next mutate.
  const mutError = createGroup.error ?? renameGroup.error ?? deleteGroup.error ?? setGroup.error
  const mutErrorMsg = mutError ? (mutError instanceof Error ? mutError.message : String(mutError)) : null

  function commitNewGroup(): void {
    const name = (newGroupName ?? '').trim()
    setNewGroupName(null)
    if (name) createGroup.mutate({ name, parentId: null }) // empty → just cancel (backend rejects blanks too)
  }

  function commitRename(): void {
    if (!renaming) return
    const name = renaming.name.trim()
    const before = (groups ?? []).find((g) => g.id === renaming.id)?.name
    setRenaming(null)
    if (name && name !== before) renameGroup.mutate({ id: renaming.id, name })
  }

  function sectionKey(section: GroupSection): string {
    return section.group?.id ?? 'ungrouped'
  }

  /** The dragged connection's effective group (stale ids count as ungrouped). */
  function effectiveGroupId(c: ConnectionConfig): string | null {
    return c.groupId != null && knownGroupIds.has(c.groupId) ? c.groupId : null
  }

  function onSectionDragOver(e: DragEvent<HTMLElement>, section: GroupSection): void {
    // Without preventDefault here, drop never fires — so this also disables drops.
    if (!hasGroups || !e.dataTransfer.types.includes(CONN_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverKey(sectionKey(section))
  }

  function onSectionDragLeave(e: DragEvent<HTMLElement>): void {
    // Ignore leave events fired while moving between the section's own children.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverKey(null)
  }

  function onSectionDrop(e: DragEvent<HTMLElement>, section: GroupSection): void {
    if (!e.dataTransfer.types.includes(CONN_MIME)) return
    e.preventDefault()
    setDragOverKey(null)
    const id = e.dataTransfer.getData(CONN_MIME)
    const conn = connections?.find((c) => c.id === id)
    if (!conn) return
    const targetGroupId = section.group?.id ?? null
    if (effectiveGroupId(conn) === targetGroupId) return // dropped where it already lives
    setGroup.mutate({ connectionId: id, groupId: targetGroupId })
  }

  const menuEl = menu && (
    <div
      className="tab-menu-backdrop"
      onMouseDown={() => setMenu(null)}
      onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
    >
      <div className="tab-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="tab-menu-item"
          role="menuitem"
          onClick={() => {
            setRenaming({ id: menu.group.id, name: menu.group.name })
            setMenu(null)
          }}
        >
          Rename
        </button>
        <button
          className="tab-menu-item"
          role="menuitem"
          onClick={() => {
            deleteGroup.mutate(menu.group.id) // non-destructive: members just become ungrouped
            setMenu(null)
          }}
        >
          Delete group
        </button>
      </div>
    </div>
  )

  const card = (c: ConnectionConfig): JSX.Element => (
    <button
      key={c.id}
      className={`dash-card${c.id === activeConnectionId ? ' active' : ''}`}
      style={{ ['--card-accent' as never]: c.color }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CONN_MIME, c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      // detail guard: the first click of a double-click already selects; the
      // second shouldn't re-fire before onDoubleClick opens the tab.
      onClick={(e) => {
        if (e.detail === 1) setActiveConnection(c.id)
      }}
      onDoubleClick={() => {
        setActiveConnection(c.id)
        openQueryTab({ connectionId: c.id })
      }}
      aria-pressed={c.id === activeConnectionId}
    >
      <span className="dash-card-strip" aria-hidden="true" />
      <span className="dash-card-head">
        <span className="dash-card-name">{c.name}</span>
        {/* span-as-button: a real <button> can't nest inside the card button */}
        <span
          className="dash-card-edit"
          role="button"
          tabIndex={0}
          aria-label={`Edit ${c.name}`}
          title="Edit connection"
          onClick={(e) => {
            e.stopPropagation()
            openModal({ mode: 'edit', id: c.id })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              openModal({ mode: 'edit', id: c.id })
            }
          }}
        >
          ✎
        </span>
      </span>
      <span className="dash-card-meta">
        <span className="dash-badge">{c.type}</span>
        {c.readOnly && (
          <span className="dash-badge lock" title="Read-only connection">
            🔒 read-only
          </span>
        )}
      </span>
      <span className="dash-card-host">
        {c.host}:{c.port}
        {c.database ? ` · ${c.database}` : ''}
      </span>
      {c.id === activeConnectionId && (
        <span className="dash-card-check" aria-hidden="true">
          ✓ active
        </span>
      )}
    </button>
  )

  const newConnectionCard = (
    <button className="dash-card new" onClick={() => openModal({ mode: 'create' })}>
      <span className="dash-new-plus" aria-hidden="true">
        ＋
      </span>
      <span>New connection</span>
    </button>
  )

  return (
    <div className="dash">
      <div className="dash-title-row">
        <h2 className="dash-title">Connections</h2>
        <span className="dash-newgroup">
          {newGroupName !== null ? (
            <input
              className="filter-input"
              placeholder="Group name"
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewGroup()
                else if (e.key === 'Escape') setNewGroupName(null)
              }}
              onBlur={() => setNewGroupName(null)}
            />
          ) : (
            <button className="btn" onClick={() => setNewGroupName('')}>
              ＋ New group
            </button>
          )}
        </span>
      </div>
      <p className="dash-sub">Click a card to select it — double-click to open a query tab.</p>
      {mutErrorMsg && (
        <p className="dash-error" role="alert">
          {mutErrorMsg}
        </p>
      )}
      {sections.map((section) => {
        const key = sectionKey(section)
        const g = section.group
        return (
          <section
            key={key}
            className={`dash-group${dragOverKey === key ? ' dragover' : ''}`}
            onDragOver={(e) => onSectionDragOver(e, section)}
            onDragLeave={onSectionDragLeave}
            onDrop={(e) => onSectionDrop(e, section)}
          >
            {hasGroups && (
              <div
                className="dash-group-head"
                onContextMenu={
                  g
                    ? (e) => {
                        e.preventDefault()
                        setMenu({ x: e.clientX, y: e.clientY, group: g })
                      }
                    : undefined
                }
              >
                {g && renaming?.id === g.id ? (
                  <input
                    className="filter-input"
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <span className="dash-group-name">{g ? g.name : 'Ungrouped'}</span>
                )}
                <span className="dash-badge">{section.connections.length}</span>
                {g && (
                  <button
                    className="dash-group-menu"
                    aria-label={`Group ${g.name} menu`}
                    title="Rename or delete group"
                    onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, group: g })}
                  >
                    ⋯
                  </button>
                )}
              </div>
            )}
            {section.connections.length === 0 ? (
              <p className="dash-drop-hint">Drag connections here</p>
            ) : (
              <div className="dash-grid">
                {section.connections.map(card)}
                {g === null && newConnectionCard}
              </div>
            )}
          </section>
        )
      })}
      {/* Everything is grouped → the Ungrouped section shows only the drop hint,
          so the new-connection card gets its own trailing grid. */}
      {ungroupedEmpty && <div className="dash-grid">{newConnectionCard}</div>}
      {menuEl}
      <p className="dash-hint">
        {mod}K palette · double-click a table to query it · {mod}B toggles the side panel
      </p>
    </div>
  )
}
