import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { ConnectionGroup } from '../../shared/domain'

interface Row {
  id: string; name: string; parent_id: string | null; position: number; created_at: number
}

function toGroup(r: Row): ConnectionGroup {
  return { id: r.id, name: r.name, parentId: r.parent_id, position: r.position, createdAt: r.created_at }
}

/** Trim + reject blank names; both create and rename share the rule. */
function cleanName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Group name is empty')
  return trimmed
}

export function listGroups(db: DB): ConnectionGroup[] {
  return (db.prepare('SELECT * FROM connection_groups ORDER BY position, created_at').all() as Row[]).map(toGroup)
}

/** New groups append: position = current max + 1 (0 for the first). Non-null parentId
 *  makes a subgroup; the parent must exist and be a root group (max depth 2). */
export function createGroup(db: DB, name: string, now: number, parentId: string | null = null): ConnectionGroup {
  if (parentId !== null) {
    const parent = getGroup(db, parentId)
    if (!parent) throw new Error(`Group not found: ${parentId}`)
    if (parent.parentId !== null) throw new Error('Subgroups cannot have subgroups')
  }
  const id = randomUUID()
  db.prepare(`INSERT INTO connection_groups (id, name, parent_id, position, created_at)
    VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM connection_groups), ?)`)
    .run(id, cleanName(name), parentId, now)
  return getGroup(db, id) as ConnectionGroup
}

export function renameGroup(db: DB, id: string, name: string): ConnectionGroup {
  const res = db.prepare('UPDATE connection_groups SET name = ? WHERE id = ?').run(cleanName(name), id)
  if (res.changes === 0) throw new Error(`Group not found: ${id}`)
  return getGroup(db, id) as ConnectionGroup
}

/** Members are ungrouped, never deleted: connections.group_id is ON DELETE SET NULL. */
export function deleteGroup(db: DB, id: string): void {
  db.prepare('DELETE FROM connection_groups WHERE id = ?').run(id)
}

function getGroup(db: DB, id: string): ConnectionGroup | null {
  const row = db.prepare('SELECT * FROM connection_groups WHERE id = ?').get(id) as Row | undefined
  return row ? toGroup(row) : null
}
