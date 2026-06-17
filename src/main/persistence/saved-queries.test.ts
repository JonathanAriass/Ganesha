import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection, deleteConnection } from './connections'
import {
  createSavedQuery, listSavedQueries, getSavedQuery, updateSavedQuery, deleteSavedQuery
} from './saved-queries'
import type { ConnectionInput } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false, requireCommit: true,
  authSource: '', replicaSet: '', ssh: null
}
let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('saved queries service', () => {
  it('creates a saved query and reads it back', () => {
    const c = createConnection(db, input, 1)
    const q = createSavedQuery(db, { connectionId: c.id, name: 'Top customers', query: 'SELECT 1' }, 10)
    expect(q.id).toBeTruthy()
    expect(q.createdAt).toBe(10)
    expect(q.updatedAt).toBe(10)
    expect(getSavedQuery(db, q.id)).toEqual(q)
    expect(listSavedQueries(db, c.id)).toEqual([q])
  })

  it('lists name-ordered case-insensitively and only for the given connection', () => {
    const c1 = createConnection(db, input, 1)
    const c2 = createConnection(db, { ...input, name: 'other' }, 1)
    createSavedQuery(db, { connectionId: c1.id, name: 'beta', query: 'b' }, 10)
    createSavedQuery(db, { connectionId: c1.id, name: 'Alpha', query: 'a' }, 20)
    createSavedQuery(db, { connectionId: c2.id, name: 'elsewhere', query: 'x' }, 30)
    expect(listSavedQueries(db, c1.id).map((q) => q.name)).toEqual(['Alpha', 'beta'])
  })

  it('updates name only, keeping the query and bumping updated_at', () => {
    const c = createConnection(db, input, 1)
    const q = createSavedQuery(db, { connectionId: c.id, name: 'old', query: 'SELECT 1' }, 10)
    const u = updateSavedQuery(db, q.id, { name: 'new' }, 20)
    expect(u.name).toBe('new')
    expect(u.query).toBe('SELECT 1')
    expect(u.createdAt).toBe(10)
    expect(u.updatedAt).toBe(20)
  })

  it('updates query only, keeping the name', () => {
    const c = createConnection(db, input, 1)
    const q = createSavedQuery(db, { connectionId: c.id, name: 'n', query: 'SELECT 1' }, 10)
    const u = updateSavedQuery(db, q.id, { query: 'SELECT 2' }, 20)
    expect(u.name).toBe('n')
    expect(u.query).toBe('SELECT 2')
  })

  it('throws when updating an unknown id', () => {
    expect(() => updateSavedQuery(db, 'nope', { name: 'x' }, 1)).toThrow(/not found/i)
  })

  it('deletes a saved query', () => {
    const c = createConnection(db, input, 1)
    const q = createSavedQuery(db, { connectionId: c.id, name: 'n', query: 'q' }, 10)
    deleteSavedQuery(db, q.id)
    expect(getSavedQuery(db, q.id)).toBeNull()
    expect(listSavedQueries(db, c.id)).toEqual([])
  })

  it('cascades when the connection is deleted', () => {
    const c = createConnection(db, input, 1)
    const q = createSavedQuery(db, { connectionId: c.id, name: 'n', query: 'q' }, 10)
    deleteConnection(db, c.id)
    expect(getSavedQuery(db, q.id)).toBeNull()
  })
})
