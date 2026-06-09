import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection, listConnections, getConnection, updateConnection, deleteConnection } from './connections'
import type { ConnectionInput } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'prod', color: '#6366f1', host: 'localhost',
  port: 5432, username: 'admin', database: 'app', ssl: true, readOnly: false
}

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('connections service', () => {
  it('creates and reads back a connection with an id and timestamps', () => {
    const c = createConnection(db, input, 1000)
    expect(c.id).toMatch(/.+/)
    expect(c.createdAt).toBe(1000)
    expect(c.name).toBe('prod')
    expect(getConnection(db, c.id)).toEqual(c)
  })

  it('lists connections newest-first', () => {
    createConnection(db, { ...input, name: 'a' }, 1000)
    createConnection(db, { ...input, name: 'b' }, 2000)
    expect(listConnections(db).map((c) => c.name)).toEqual(['b', 'a'])
  })

  it('updates fields and bumps updated_at', () => {
    const c = createConnection(db, input, 1000)
    const updated = updateConnection(db, c.id, { name: 'renamed', readOnly: true }, 5000)
    expect(updated.name).toBe('renamed')
    expect(updated.readOnly).toBe(true)
    expect(updated.updatedAt).toBe(5000)
    expect(updated.createdAt).toBe(1000)
  })

  it('deletes a connection', () => {
    const c = createConnection(db, input, 1000)
    deleteConnection(db, c.id)
    expect(getConnection(db, c.id)).toBeNull()
  })
})
