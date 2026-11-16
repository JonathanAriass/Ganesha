import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from './db'

describe('migrate', () => {
  it('creates the expected tables', () => {
    const db = new Database(':memory:')
    migrate(db)
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name)
    expect(tables).toContain('connections')
    expect(tables).toContain('secrets')
    expect(tables).toContain('query_history')
    expect(tables).toContain('settings')
  })

  it('adds the environment column to an older connections table', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE connections (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1',
      host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL DEFAULT '', db_name TEXT NOT NULL DEFAULT '',
      ssl INTEGER NOT NULL DEFAULT 0, read_only INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    db.prepare("INSERT INTO connections (id,type,name,host,port,created_at,updated_at) VALUES ('c1','postgres','old','h',5432,1,1)").run()
    migrate(db)
    expect((db.prepare('SELECT environment FROM connections WHERE id = ?').get('c1') as { environment: string }).environment).toBe('')
  })

  it('is idempotent (safe to run twice)', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
  })
})
