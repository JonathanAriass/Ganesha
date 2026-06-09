import type { DB } from './db'
import type { HistoryEntry, HistoryEntryInput } from '../../shared/domain'

interface Row {
  id: number; connection_id: string; query: string
  ran_at: number; duration_ms: number | null; success: number | null
}
function toEntry(r: Row): HistoryEntry {
  return {
    id: r.id, connectionId: r.connection_id, query: r.query, ranAt: r.ran_at,
    durationMs: r.duration_ms, success: r.success === null ? null : !!r.success
  }
}

export function addHistory(db: DB, e: HistoryEntryInput): HistoryEntry {
  const info = db.prepare(
    `INSERT INTO query_history (connection_id, query, ran_at, duration_ms, success)
     VALUES (@connectionId, @query, @ranAt, @durationMs, @success)`
  ).run({ ...e, success: e.success === null ? null : e.success ? 1 : 0 })
  return toEntry(db.prepare('SELECT * FROM query_history WHERE id = ?').get(Number(info.lastInsertRowid)) as Row)
}

export function listHistory(db: DB, connectionId: string, limit = 100): HistoryEntry[] {
  return (db.prepare(
    'SELECT * FROM query_history WHERE connection_id = ? ORDER BY ran_at DESC, id DESC LIMIT ?'
  ).all(connectionId, limit) as Row[]).map(toEntry)
}
