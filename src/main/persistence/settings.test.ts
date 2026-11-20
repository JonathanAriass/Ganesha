import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { getSettings, setSetting } from './settings'

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('settings service', () => {
  it('returns defaults when nothing is stored', () => {
    expect(getSettings(db)).toEqual({ theme: 'midnight', density: 'comfortable', defaultLimit: 100 })
  })
  it('persists and reads back an overridden setting', () => {
    setSetting(db, 'theme', 'light')
    expect(getSettings(db).theme).toBe('light')
  })
  it('ignores unknown keys when building typed settings', () => {
    setSetting(db, 'bogus', 'x')
    expect(getSettings(db)).toEqual({ theme: 'midnight', density: 'comfortable', defaultLimit: 100 })
  })
  it('preserves any known theme id (not just light)', () => {
    setSetting(db, 'theme', 'dracula')
    expect(getSettings(db).theme).toBe('dracula')
  })
  it('falls back to the default for an unknown theme value', () => {
    setSetting(db, 'theme', 'not-a-theme')
    expect(getSettings(db).theme).toBe('midnight')
  })
  it('reads the default limit, capping it and ignoring nonsense', () => {
    setSetting(db, 'defaultLimit', '250')
    expect(getSettings(db).defaultLimit).toBe(250)
    setSetting(db, 'defaultLimit', '9999999')
    expect(getSettings(db).defaultLimit).toBe(50000)
    for (const bad of ['0', '-5', '1.5', 'abc', '']) {
      setSetting(db, 'defaultLimit', bad)
      expect(getSettings(db).defaultLimit).toBe(100)
    }
  })
  it('defaults density to comfortable and persists compact', () => {
    expect(getSettings(db).density).toBe('comfortable')
    setSetting(db, 'density', 'compact')
    expect(getSettings(db).density).toBe('compact')
  })
  it('falls back to comfortable for an unknown density value', () => {
    setSetting(db, 'density', 'huge')
    expect(getSettings(db).density).toBe('comfortable')
  })
})
