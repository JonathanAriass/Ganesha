import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection, deleteConnection } from './connections'
import { listSessionTabs, saveSessionTabs } from './session'
import type { ConnectionInput, SessionTab } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false, requireCommit: true,
  authSource: '', replicaSet: '', ssh: null, repoPath: null
}
let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

function tab(over: Partial<SessionTab> & { id: string; connectionId: string }): SessionTab {
  return { title: 'Query 1', text: 'SELECT 1', pane: 'left', active: false, ...over }
}

describe('session tabs service', () => {
  it('starts empty', () => {
    expect(listSessionTabs(db)).toEqual([])
  })

  it('round-trips tabs preserving array order and the active flag', () => {
    const c = createConnection(db, input, 1)
    const tabs = [
      tab({ id: 'b', connectionId: c.id, title: 'Query 2', text: 'SELECT 2' }),
      tab({ id: 'a', connectionId: c.id, active: true }),
      tab({ id: 'c', connectionId: c.id, title: 'Query 3', text: '' })
    ]
    saveSessionTabs(db, tabs)
    // Order is positional (b, a, c), not id-ordered.
    expect(listSessionTabs(db)).toEqual(tabs)
  })

  it('replaces the whole session on every save', () => {
    const c = createConnection(db, input, 1)
    saveSessionTabs(db, [tab({ id: 'a', connectionId: c.id }), tab({ id: 'b', connectionId: c.id })])
    saveSessionTabs(db, [tab({ id: 'b', connectionId: c.id, active: true })])
    expect(listSessionTabs(db).map((t) => t.id)).toEqual(['b'])
  })

  it('saving an empty array clears the session', () => {
    const c = createConnection(db, input, 1)
    saveSessionTabs(db, [tab({ id: 'a', connectionId: c.id })])
    saveSessionTabs(db, [])
    expect(listSessionTabs(db)).toEqual([])
  })

  it('skips tabs whose connection is gone without voiding the rest', () => {
    const c = createConnection(db, input, 1)
    saveSessionTabs(db, [
      tab({ id: 'a', connectionId: c.id }),
      tab({ id: 'ghost', connectionId: 'deleted-conn' }),
      tab({ id: 'b', connectionId: c.id, active: true })
    ])
    expect(listSessionTabs(db).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('rolls back the whole save when an insert fails — never a half-empty session', () => {
    const c = createConnection(db, input, 1)
    saveSessionTabs(db, [tab({ id: 'a', connectionId: c.id }), tab({ id: 'b', connectionId: c.id })])
    // Duplicate id violates the PK mid-transaction; the DELETE must roll back too.
    expect(() =>
      saveSessionTabs(db, [tab({ id: 'dup', connectionId: c.id }), tab({ id: 'dup', connectionId: c.id })])
    ).toThrow()
    expect(listSessionTabs(db).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('round-trips the pane column', () => {
    const c = createConnection(db, input, 1)
    const tabs = [
      tab({ id: 'a', connectionId: c.id, pane: 'left', active: true }),
      tab({ id: 'b', connectionId: c.id, pane: 'right', active: true }),
    ]
    saveSessionTabs(db, tabs)
    expect(listSessionTabs(db)).toEqual(tabs)
  })

  it('defaults legacy rows (no pane column value) to left', () => {
    const c = createConnection(db, input, 1)
    db.prepare(
      `INSERT INTO session_tabs (id, connection_id, title, text, position, active) VALUES (?,?,?,?,?,?)`
    ).run('legacy', c.id, 'L', 'x', 0, 1)
    expect(listSessionTabs(db)[0].pane).toBe('left')
  })

  it('cascades when the connection is deleted', () => {
    const c1 = createConnection(db, input, 1)
    const c2 = createConnection(db, { ...input, name: 'other' }, 1)
    saveSessionTabs(db, [tab({ id: 'a', connectionId: c1.id }), tab({ id: 'b', connectionId: c2.id })])
    deleteConnection(db, c1.id)
    expect(listSessionTabs(db).map((t) => t.id)).toEqual(['b'])
  })
})
