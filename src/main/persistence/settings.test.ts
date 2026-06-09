import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { getSettings, setSetting } from './settings'

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('settings service', () => {
  it('returns defaults when nothing is stored', () => {
    expect(getSettings(db)).toEqual({ theme: 'midnight' })
  })
  it('persists and reads back an overridden setting', () => {
    setSetting(db, 'theme', 'light')
    expect(getSettings(db).theme).toBe('light')
  })
  it('ignores unknown keys when building typed settings', () => {
    setSetting(db, 'bogus', 'x')
    expect(getSettings(db)).toEqual({ theme: 'midnight' })
  })
})
