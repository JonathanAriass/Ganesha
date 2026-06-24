import type { DB } from './db'
import type { SessionTab } from '../../shared/domain'

interface Row {
  id: string; connection_id: string; title: string; text: string
  position: number; active: number; pane: string
}

function toSessionTab(r: Row): SessionTab {
  return {
    id: r.id, connectionId: r.connection_id, title: r.title, text: r.text,
    pane: r.pane === 'right' ? 'right' : 'left', active: r.active === 1,
  }
}

/** The persisted tab strip in display order. */
export function listSessionTabs(db: DB): SessionTab[] {
  return (db.prepare('SELECT * FROM session_tabs ORDER BY position, id').all() as Row[]).map(toSessionTab)
}

/**
 * Replace the whole persisted session with `tabs` (array order = display order).
 * Tabs whose connection no longer exists are silently skipped: a connection
 * delete racing the renderer's debounced save must not void the rest of the
 * session (and must not resurrect the FK row the CASCADE just removed).
 */
export function saveSessionTabs(db: DB, tabs: SessionTab[]): void {
  const connExists = db.prepare('SELECT EXISTS(SELECT 1 FROM connections WHERE id = ?) AS e')
  const insert = db.prepare(`INSERT INTO session_tabs (id, connection_id, title, text, position, active, pane)
    VALUES (@id, @connectionId, @title, @text, @position, @active, @pane)`)
  db.transaction(() => {
    db.prepare('DELETE FROM session_tabs').run()
    tabs.forEach((t, i) => {
      if ((connExists.get(t.connectionId) as { e: number }).e !== 1) return
      insert.run({ id: t.id, connectionId: t.connectionId, title: t.title, text: t.text, position: i, active: t.active ? 1 : 0, pane: t.pane })
    })
  })()
}
