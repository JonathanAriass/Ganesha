import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection, listConnections, getConnection, updateConnection, deleteConnection } from './connections'
import type { ConnectionInput } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'prod', color: '#6366f1', host: 'localhost',
  port: 5432, username: 'admin', database: 'app', ssl: true, readOnly: false,
  authSource: '', replicaSet: ''
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

  it('round-trips mongo authSource and replicaSet', () => {
    const c = createConnection(
      db,
      { ...input, type: 'mongodb', authSource: 'admin', replicaSet: 'rs0' },
      1000
    )
    expect(getConnection(db, c.id)).toMatchObject({ authSource: 'admin', replicaSet: 'rs0' })
    const updated = updateConnection(db, c.id, { replicaSet: 'rs1' }, 2000)
    expect(updated).toMatchObject({ authSource: 'admin', replicaSet: 'rs1' })
  })

  it('migrates a pre-authSource database by adding the new columns', () => {
    const legacy: DB = new Database(':memory:')
    // The connections schema as it shipped before auth_source/replica_set existed.
    legacy.exec(`
      CREATE TABLE connections (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        host        TEXT NOT NULL,
        port        INTEGER NOT NULL,
        username    TEXT NOT NULL DEFAULT '',
        db_name     TEXT NOT NULL DEFAULT '',
        ssl         INTEGER NOT NULL DEFAULT 0,
        read_only   INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `)
    legacy.prepare(`INSERT INTO connections (id,type,name,host,port,created_at,updated_at)
      VALUES ('old','postgres','legacy','localhost',5432,1,1)`).run()

    migrate(legacy) // must add the columns without touching existing rows
    migrate(legacy) // and stay idempotent

    expect(getConnection(legacy, 'old')).toMatchObject({
      name: 'legacy',
      authSource: '',
      replicaSet: ''
    })
  })
})
