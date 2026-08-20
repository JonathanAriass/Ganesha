import { useAppStore } from '../state/store'
import { mod } from '../lib/platform'
import { Icon } from './icons'
import type { SideSection } from '../lib/side-panel'

/** The Focus Mode icon rail: switches/collapses the side panel and opens the
 *  diagram tab. Content sections live in SidePanel; this is pure navigation. */
export default function Rail(): JSX.Element {
  const sideOpen = useAppStore((s) => s.sideOpen)
  const sideSection = useAppStore((s) => s.sideSection)
  const selectSideSection = useAppStore((s) => s.selectSideSection)
  const toggleSide = useAppStore((s) => s.toggleSide)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openDiagramTab = useAppStore((s) => s.openDiagramTab)

  const sections: Array<{ id: SideSection; icon: 'db' | 'bookmark' | 'clock'; label: string }> = [
    { id: 'schema', icon: 'db', label: 'Schema' },
    { id: 'saved', icon: 'bookmark', label: 'Saved queries' },
    { id: 'history', icon: 'clock', label: 'History' },
  ]

  return (
    <nav className="rail" aria-label="Sidebar sections">
      {sections.map((s) => (
        <button
          key={s.id}
          className={`rail-btn${sideOpen && sideSection === s.id ? ' active' : ''}`}
          onClick={() => selectSideSection(s.id)}
          aria-label={s.label}
          aria-pressed={sideOpen && sideSection === s.id}
          data-tooltip={s.label}
          data-tip="rail"
        >
          <Icon name={s.icon} size={18} />
        </button>
      ))}
      <button
        className="rail-btn"
        disabled={!activeConnectionId}
        onClick={() => activeConnectionId && openDiagramTab(activeConnectionId)}
        aria-label="Schema diagram"
        data-tooltip="Schema diagram"
        data-tip="rail"
      >
        <Icon name="diagram" size={18} />
      </button>
      <span className="rail-spacer" />
      <button
        className="rail-btn"
        onClick={toggleSide}
        aria-label={sideOpen ? 'Collapse side panel' : 'Expand side panel'}
        aria-pressed={sideOpen}
        data-tooltip={`${sideOpen ? 'Collapse' : 'Expand'} panel (${mod}B)`}
        data-tip="rail"
      >
        <Icon name="panel" size={18} />
      </button>
    </nav>
  )
}
