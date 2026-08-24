import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useConnections } from '../lib/hooks'

/** The TopBar connection picker: a proper menu panel instead of a native
 *  <select>, which cramped long connection lists. Wide scrollable list with a
 *  filter box, per-row color dot / engine / read-only badge, and a
 *  "New connection" footer action. */
export default function ConnectionMenu(): JSX.Element {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const openModal = useAppStore((s) => s.openModal)
  const { data: connections = [] } = useConnections()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const active = connections.find((c) => c.id === activeConnectionId) ?? null

  // Close on any press outside the menu (capture the panel AND the trigger).
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // Fresh filter + focus it on every open, so typing narrows immediately.
  useEffect(() => {
    if (open) {
      setQuery('')
      inputRef.current?.focus()
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? connections.filter((c) => `${c.name} ${c.type}`.toLowerCase().includes(q))
    : connections

  function choose(id: string | null): void {
    setActiveConnection(id)
    setOpen(false)
  }

  /** Roving focus: ↓/↑ move through the rows, from the filter box downward. */
  function onPanelKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('.connmenu-row') ?? []
    )
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') rows[Math.min(i + 1, rows.length - 1)]?.focus()
    else if (i <= 0) inputRef.current?.focus()
    else rows[i - 1]?.focus()
  }

  return (
    <div className="connmenu" ref={rootRef}>
      <button
        className="connmenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Active connection"
        title="Switch connection"
      >
        <span
          className="conn-dot"
          style={{ background: active?.color ?? 'transparent' }}
          aria-hidden="true"
        />
        <span className="cm-name">{active ? active.name : '— no connection —'}</span>
        {active && (
          <span className="cm-type">
            {active.type}
            {active.readOnly ? ' 🔒' : ''}
          </span>
        )}
        <span className="connmenu-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="connmenu-panel" role="listbox" aria-label="Connections" onKeyDown={onPanelKeyDown}>
          <div className="connmenu-filter">
            <input
              ref={inputRef}
              className="filter-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter connections…"
              aria-label="Filter connections"
              spellCheck={false}
            />
          </div>
          <div className="connmenu-list">
            {filtered.length === 0 && <div className="connmenu-empty">No connections match “{query}”</div>}
            {filtered.map((c) => (
              <button
                key={c.id}
                className={`connmenu-row${c.id === activeConnectionId ? ' active' : ''}`}
                role="option"
                aria-selected={c.id === activeConnectionId}
                onClick={() => choose(c.id)}
              >
                <span className="conn-dot" style={{ background: c.color }} aria-hidden="true" />
                <span className="cm-name">{c.name}</span>
                <span className="cm-type">
                  {c.type}
                  {c.readOnly ? ' 🔒' : ''}
                </span>
                {c.id === activeConnectionId && (
                  <span className="connmenu-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
            {!q && connections.length > 0 && (
              <button
                className={`connmenu-row${activeConnectionId === null ? ' active' : ''}`}
                role="option"
                aria-selected={activeConnectionId === null}
                onClick={() => choose(null)}
              >
                <span className="conn-dot" style={{ background: 'transparent' }} aria-hidden="true" />
                <span className="cm-name muted">— no connection —</span>
              </button>
            )}
          </div>
          <div className="connmenu-footer">
            <button
              className="connmenu-row"
              onClick={() => {
                setOpen(false)
                openModal({ mode: 'create' })
              }}
            >
              <span className="connmenu-plus" aria-hidden="true">＋</span>
              <span className="cm-name">New connection…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
