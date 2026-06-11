import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection } from './connections'
import { addHistory, listHistory } from './history'
import type { ConnectionInput } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false,
  authSource: '', replicaSet: ''
}
let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('history service', () => {
  it('adds an entry and reads it back with an id', () => {
    const c = createConnection(db, input, 1)
    const e = addHistory(db, { connectionId: c.id, query: 'SELECT 1', ranAt: 10, durationMs: 5, success: true })
    expect(e.id).toBeGreaterThan(0)
    expect(listHistory(db, c.id)).toEqual([e])
  })

  it('lists newest-first and respects limit', () => {
    const c = createConnection(db, input, 1)
    addHistory(db, { connectionId: c.id, query: 'a', ranAt: 10, durationMs: null, success: null })
    addHistory(db, { connectionId: c.id, query: 'b', ranAt: 20, durationMs: null, success: null })
    expect(listHistory(db, c.id, 1).map((e) => e.query)).toEqual(['b'])
  })
})
