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

  it('is idempotent (safe to run twice)', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
  })
})
