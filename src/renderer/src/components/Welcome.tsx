import { useState, type DragEvent, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ConnectionConfig, ConnectionGroup } from '@shared/domain'
import { useAppStore } from '../state/store'
import { useConnections, useGroups, useCreateGroup, useRenameGroup, useDeleteGroup, useSetConnectionGroup } from '../lib/hooks'
import { groupSections, filterSections, CONN_MIME, type GroupSection } from '../lib/connection-groups'
import { groupTabs } from '../lib/tab-groups'
import { connectionModeText, connectionModeShort, openTabsLabel } from '../lib/connection-display'
import EnvTag from './EnvTag'
import { Icon } from './icons'
import { mod } from '../lib/platform'
import { startImport } from '../lib/transfer-actions'
import { unwrap } from '../lib/result'
import ScrollArrows from './ScrollArrows'

// The tag an imported connection keeps on its card, and its tooltip.
const IMPORTED_LABEL = { ganesha: 'Imported', compass: 'Compass', dbeaver: 'DBeaver' } as const
const IMPORTED_TITLE = {
  ganesha: 'Imported from a Ganesha export', compass: 'Imported from MongoDB Compass', dbeaver: 'Imported from DBeaver'
} as const

/** The connections dashboard, shown in the main area when no tabs are open or from the
 *  sidebar's Home button: every connection as a card (click = select, double-click = open
 *  a query tab, pencil = edit), arranged in group sections — root groups may nest one
 *  level of subgroups (indented sub-sections, each its own drop target) — under one
 *  action row (filter, import, export, new group, new connection). Drag a card onto any
 *  section to move it (not while a filter is active). */
export default function Welcome(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const openModal = useAppStore((s) => s.openModal)
  const tabs = useAppStore((s) => s.tabs)

  const { data: connections, isLoading, error } = useConnections()
  const { data: groups, isLoading: groupsLoading, error: groupsError } = useGroups()

  const createGroup = useCreateGroup()
  const renameGroup = useRenameGroup()
  const deleteGroup = useDeleteGroup()
  const setGroup = useSetConnectionGroup()

  // ＋ New group inline form (null = collapsed, string = the draft name).
  const [newGroupName, setNewGroupName] = useState<string | null>(null)
  // "New subgroup" inline form inside a root section (from that group's ⋯ menu).
  const [newSubgroup, setNewSubgroup] = useState<{ parentId: string; name: string } | null>(null)
  // Inline header rename (which group + the draft name).
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  // Right-click / ⋯ context menu on a group header.
  const [menu, setMenu] = useState<{ x: number; y: number; group: ConnectionGroup } | null>(null)
  // Section currently hovered by a card drag (key = group id or 'ungrouped').
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  // A failure picking the import file (the dialog itself lives in the store).
  const setTransferModal = useAppStore((s) => s.setTransferModal)
  const [importError, setImportError] = useState<string | null>(null)
  // Dashboard filter (name / host / engine).
  const [filter, setFilter] = useState('')

  // Other tools installed here (DBeaver, MongoDB Compass) whose connections can be brought in.
  const { data: importSources = [] } = useQuery({
    queryKey: ['import-sources'],
    queryFn: async () => unwrap(await window.api.connections.importSources()),
    staleTime: 0
  })
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null)

  async function importConnections(detectedId?: string): Promise<void> {
    setImportMenu(null)
    setImportError(null)
    setImportError(await startImport(detectedId))
  }
  // With nothing detected the button goes straight to the file picker; otherwise it lists
  // the tools found, and the file picker last.
  function onImportClick(e: MouseEvent<HTMLButtonElement>): void {
    if (importSources.length === 0) { void importConnections(); return }
    const r = e.currentTarget.getBoundingClientRect()
    setImportMenu({ x: r.left, y: r.bottom + 4 })
  }
  const importMenuEl = importMenu && (
    <div className="tab-menu-backdrop" onMouseDown={() => setImportMenu(null)}>
      <div
        className="tab-menu"
        role="menu"
        aria-label="Import connections"
        style={{ left: importMenu.x, top: importMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') setImportMenu(null) }}
      >
        {importSources.map((s, i) => (
          <button key={s.id} className="tab-menu-item" role="menuitem" autoFocus={i === 0} onClick={() => void importConnections(s.id)}>
            From {s.label} <span className="dash-count">{s.connections}</span>
          </button>
        ))}
        <button className="tab-menu-item" role="menuitem" onClick={() => void importConnections()}>
          From a file…
        </button>
      </div>
    </div>
  )

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
        {importSources.map((s) => (
          <button key={s.id} className="btn" onClick={() => void importConnections(s.id)}>
            Import {s.connections} from {s.label}
          </button>
        ))}
        <button className="btn" onClick={() => void importConnections()}>
          {importSources.length > 0 ? 'Import from a file…' : 'Import connections…'}
        </button>
        {importError && (
          <p className="dash-error" role="alert">
            {importError}
          </p>
        )}
      </div>
    )
  }

  const filtering = filter.trim() !== ''
  const sections = filterSections(groupSections(groups ?? [], connections), filter)
  const openTabs = new Map(groupTabs(tabs).map((g) => [g.connectionId, g.tabs.length]))
  const knownGroupIds = new Set((groups ?? []).map((g) => g.id))
  // No groups → the single ungrouped section renders headerless (pre-groups look)
  // and isn't a drop target — there is nowhere to move a card to.
  const hasGroups = (groups ?? []).length > 0

  // First mutation error wins for the inline notice; each clears on its next mutate.
  const mutError = createGroup.error ?? renameGroup.error ?? deleteGroup.error ?? setGroup.error
  const mutErrorMsg = mutError ? (mutError instanceof Error ? mutError.message : String(mutError)) : importError

  function commitNewGroup(): void {
    const name = (newGroupName ?? '').trim()
    setNewGroupName(null)
    if (name) createGroup.mutate({ name, parentId: null }) // empty → just cancel (backend rejects blanks too)
  }

  function commitNewSubgroup(): void {
    if (!newSubgroup) return
    const { parentId } = newSubgroup
    const name = newSubgroup.name.trim()
    setNewSubgroup(null)
    if (name) createGroup.mutate({ name, parentId })
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

  function onSectionDragOver(e: DragEvent<HTMLElement>, section: GroupSection, sub = false): void {
    // Without preventDefault here, drop never fires — so this also disables drops.
    if (!hasGroups || filtering || !e.dataTransfer.types.includes(CONN_MIME)) return
    // Nested drop targets: a subgroup handles the drag alone — don't let the event
    // bubble into the enclosing root section's handler too.
    if (sub) e.stopPropagation()
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverKey(sectionKey(section))
  }

  function onSectionDragLeave(e: DragEvent<HTMLElement>): void {
    // Ignore leave events fired while moving between the section's own children.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverKey(null)
  }

  function onSectionDrop(e: DragEvent<HTMLElement>, section: GroupSection, sub = false): void {
    if (!e.dataTransfer.types.includes(CONN_MIME)) return
    if (sub) e.stopPropagation() // the parent section must not also claim this drop
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
        {menu.group.parentId === null && (
          <button
            className="tab-menu-item"
            role="menuitem"
            onClick={() => {
              setNewSubgroup({ parentId: menu.group.id, name: '' })
              setMenu(null)
            }}
          >
            New subgroup
          </button>
        )}
        <button
          className="tab-menu-item"
          role="menuitem"
          onClick={() => {
            // Non-destructive: members ungroup; a parent's subgroups become root groups.
            deleteGroup.mutate(menu.group.id)
            setMenu(null)
          }}
        >
          Delete group
        </button>
      </div>
    </div>
  )

  const card = (c: ConnectionConfig): JSX.Element => {
    const modeShort = connectionModeShort(c)
    const tabsLabel = openTabsLabel(openTabs.get(c.id) ?? 0)
    return (
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
      <span className="dash-card-head">
        <span className="conn-dot" style={{ background: c.color }} aria-hidden="true" />
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
          <Icon name="pencil" size={14} />
        </span>
      </span>
      <span className="dash-card-meta">
        <span className="dash-badge">{c.type}</span>
        <EnvTag connection={c} />
        {c.importedFrom && (
          <span className="dash-badge dash-badge-origin" title={IMPORTED_TITLE[c.importedFrom]}>
            <Icon name="import" size={11} /> {IMPORTED_LABEL[c.importedFrom]}
          </span>
        )}
        {modeShort && (
          <span className="dash-card-mode" title={connectionModeText(c)}>
            {modeShort}
          </span>
        )}
      </span>
      <span className="dash-card-host">
        {c.host}:{c.port}
        {c.database ? ` · ${c.database}` : ''}
      </span>
      {tabsLabel && <span className="dash-card-tabs">{tabsLabel}</span>}
      {c.id === activeConnectionId && (
        <span className="dash-card-check" aria-hidden="true">
          ✓ active
        </span>
      )}
    </button>
    )
  }

  /** Section header — shared by root sections, subgroup sections, and Ungrouped
   *  (g = null: fixed name, no menu, no rename). */
  const groupHead = (g: ConnectionGroup | null, count: number): JSX.Element => (
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
      {/* A group that only holds subgroups shows no "0". */}
      {count > 0 && <span className="dash-count">{count}</span>}
      {g && (
        <button
          className="dash-group-menu"
          aria-label={`Group ${g.name} menu`}
          title={g.parentId === null ? 'Rename, subgroup, or delete group' : 'Rename or delete group'}
          onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, group: g })}
        >
          <Icon name="more" size={16} />
        </button>
      )}
    </div>
  )

  /** One indented subgroup sub-section: smaller header + its own grid, and its own
   *  drop target (handlers stop propagation so the parent section doesn't fire). */
  const renderSubgroup = (s: GroupSection): JSX.Element => {
    const g = s.group! // subgroup sections always carry a group
    return (
      <div
        key={g.id}
        className={`dash-subgroup${dragOverKey === g.id ? ' dragover' : ''}`}
        onDragOver={(e) => onSectionDragOver(e, s, true)}
        onDragLeave={onSectionDragLeave}
        onDrop={(e) => onSectionDrop(e, s, true)}
      >
        {groupHead(g, s.connections.length)}
        {s.connections.length === 0 ? (
          !filtering && <p className="dash-drop-hint">Drag connections here</p>
        ) : (
          <div className="dash-grid">{s.connections.map(card)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="dash-panel">
      {/* The head is a strip of its own, like the tab strip; only the groups below scroll. */}
      <header className="dash-head">
      <h2 className="dash-title">Connections</h2>
      <span className="dash-count">{connections.length}</span>
      <div className="dash-actions">
        <div className="dash-filter">
          <Icon name="search" size={14} />
          <input
            className="dash-filter-input"
            placeholder="Filter by name, host or engine"
            aria-label="Filter connections"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('')
            }}
          />
        </div>
        <button className="btn" aria-haspopup={importSources.length > 0 ? 'menu' : undefined} onClick={onImportClick}>
          <Icon name="import" size={14} /> Import…
        </button>
        <button className="btn" onClick={() => setTransferModal({ mode: 'export', connections })}>
          <Icon name="export" size={14} /> Export…
        </button>
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
            <Icon name="plus" size={14} /> New group
          </button>
        )}
        <button className="btn primary" onClick={() => openModal({ mode: 'create' })}>
          <Icon name="plus" size={14} /> New connection
        </button>
      </div>
      </header>
      <div className="dash">
      {mutErrorMsg && (
        <p className="dash-error" role="alert">
          {mutErrorMsg}
        </p>
      )}
      {filtering && sections.length === 0 && <p className="dash-empty">No connections match</p>}
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
            {hasGroups && groupHead(g, section.connections.length)}
            {section.connections.length === 0 ? (
              // Drops are off while filtering, so the hint would mislead; a group that only
              // holds subgroups is not empty, so it gets no hint either.
              !filtering && section.sub.length === 0 && <p className="dash-drop-hint">Drag connections here</p>
            ) : (
              <div className="dash-grid">{section.connections.map(card)}</div>
            )}
            {section.sub.map(renderSubgroup)}
            {g && newSubgroup?.parentId === g.id && (
              <span className="dash-newgroup sub">
                <input
                  className="filter-input"
                  placeholder="Subgroup name"
                  autoFocus
                  value={newSubgroup.name}
                  onChange={(e) => setNewSubgroup({ parentId: g.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitNewSubgroup()
                    else if (e.key === 'Escape') setNewSubgroup(null)
                  }}
                  onBlur={() => setNewSubgroup(null)}
                />
              </span>
            )}
          </section>
        )
      })}
      <p className="dash-hint">
        Click a card to select it · double-click to open a query tab · {mod}K searches · {mod}B toggles the side panel
      </p>
      </div>
      <ScrollArrows target=".dash" />
      {menuEl}
      {importMenuEl}
    </div>
  )
}
