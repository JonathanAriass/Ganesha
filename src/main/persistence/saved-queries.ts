import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { SavedQuery, SavedQueryInput, SavedQueryPatch } from '../../shared/domain'

interface Row {
  id: string; connection_id: string; name: string; query: string
  created_at: number; updated_at: number
}

function toSavedQuery(r: Row): SavedQuery {
  return {
    id: r.id, connectionId: r.connection_id, name: r.name, query: r.query,
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export function createSavedQuery(db: DB, input: SavedQueryInput, now: number): SavedQuery {
  const id = randomUUID()
  db.prepare(`INSERT INTO saved_queries (id, connection_id, name, query, created_at, updated_at)
    VALUES (@id, @connectionId, @name, @query, @now, @now)`).run({ id, ...input, now })
  return getSavedQuery(db, id) as SavedQuery
}

/** Name-ordered (case-insensitive) — snippets are browsed by name, not recency. */
export function listSavedQueries(db: DB, connectionId: string): SavedQuery[] {
  return (db.prepare(
    'SELECT * FROM saved_queries WHERE connection_id = ? ORDER BY name COLLATE NOCASE ASC, id'
  ).all(connectionId) as Row[]).map(toSavedQuery)
}

export function getSavedQuery(db: DB, id: string): SavedQuery | null {
  const row = db.prepare('SELECT * FROM saved_queries WHERE id = ?').get(id) as Row | undefined
  return row ? toSavedQuery(row) : null
}

export function updateSavedQuery(db: DB, id: string, patch: SavedQueryPatch, now: number): SavedQuery {
  const current = getSavedQuery(db, id)
  if (!current) throw new Error(`Saved query not found: ${id}`)
  const next = { ...current, ...patch }
  db.prepare('UPDATE saved_queries SET name=@name, query=@query, updated_at=@now WHERE id=@id')
    .run({ id, name: next.name, query: next.query, now })
  return getSavedQuery(db, id) as SavedQuery
}

export function deleteSavedQuery(db: DB, id: string): void {
  db.prepare('DELETE FROM saved_queries WHERE id = ?').run(id)
}
