import type { ReactNode } from 'react'
import { useAppStore } from '../state/store'
import { useConnections, useObjects } from '../lib/hooks'
import type { SideSection } from '../lib/side-panel'
import ObjectTree from './ObjectTree'
import SavedSection from './SavedSection'
import HistorySection from './HistorySection'
import { Icon } from './icons'
import ScrollArrows from './ScrollArrows'

const SECTIONS: Array<{ id: SideSection; label: string }> = [
  { id: 'schema', label: 'Schema' },
  { id: 'saved', label: 'Saved' },
  { id: 'history', label: 'History' },
]

/** The sidebar's lower zone: the active connection's schema, saved queries or history
 *  (the persisted `sideSection`), with its diagram / Telescope shortcuts in the header.
 *  `headerEnd` carries the sidebar's Home / Collapse buttons while the Connections zone
 *  (their usual home) is hidden. */
export default function SidebarExplorer({ headerEnd }: { headerEnd?: ReactNode }): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const section = useAppStore((s) => s.sideSection)
  const selectSideSection = useAppStore((s) => s.selectSideSection)
  const openDiagramTab = useAppStore((s) => s.openDiagramTab)
  const openTelescopeTab = useAppStore((s) => s.openTelescopeTab)

  const { data: connections = [] } = useConnections()
  const { data: objects = [] } = useObjects(activeConnectionId)

  const conn = connections.find((c) => c.id === activeConnectionId) ?? null
  // Same rule as the command palette: only when the connection has Laravel Telescope tables.
  const hasTelescope = objects.some((o) => o.name === 'telescope_entries')

  return (
    <section className="sidebar-zone sidebar-explorer" aria-label="Explorer">
      <ScrollArrows target=".side-body" />
      <div className="sidebar-head">
        {conn ? (
          <>
            <span className="conn-dot" style={{ background: conn.color }} aria-hidden="true" />
            <span className="sidebar-head-name" title={conn.name}>
              {conn.name}
            </span>
          </>
        ) : (
          <span className="sidebar-label">Explorer</span>
        )}
        <span className="spacer" />
        {conn && (
          <button
            className="icon-btn"
            onClick={() => openDiagramTab(conn.id)}
            aria-label="Schema diagram"
            data-tooltip="Schema diagram"
            data-tip="right"
          >
            <Icon name="diagram" />
          </button>
        )}
        {conn && hasTelescope && (
          <button
            className="icon-btn"
            onClick={() => openTelescopeTab(conn.id)}
            aria-label="Telescope inspector"
            data-tooltip="Telescope inspector"
            data-tip="right"
          >
            <Icon name="telescope" />
          </button>
        )}
        {headerEnd}
      </div>
      <div className="sidebar-seg" role="group" aria-label="Explorer section">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`sidebar-seg-btn${section === s.id ? ' active' : ''}`}
            aria-pressed={section === s.id}
            onClick={() => selectSideSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="side-body">
        {!activeConnectionId ? (
          <div className="sidebar-empty">
            <p>No connection selected.</p>
          </div>
        ) : section === 'schema' ? (
          <ObjectTree />
        ) : section === 'saved' ? (
          <SavedSection />
        ) : (
          <HistorySection />
        )}
      </div>
    </section>
  )
}
