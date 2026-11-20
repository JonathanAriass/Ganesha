import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { DB } from './db'
import { type AppSettings, DEFAULT_SETTINGS, DENSITIES, THEMES, parseDefaultLimit } from '../../shared/domain'
import { getDataDir, setDataDir, DB_FILENAME } from './paths'
import { closeDb } from './db'

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

/** Read a single raw setting value (null if unset). */
export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

/** Build the typed AppSettings from the key/value rows, falling back to defaults. */
export function getSettings(db: DB): AppSettings {
  const theme = getSetting(db, 'theme')
  const density = getSetting(db, 'density')
  // Accept any known theme id; unknown/legacy/null values fall back to the default.
  return {
    theme: THEMES.some((t) => t.id === theme) ? (theme as AppSettings['theme']) : DEFAULT_SETTINGS.theme,
    density: DENSITIES.some((d) => d === density) ? (density as AppSettings['density']) : DEFAULT_SETTINGS.density,
    defaultLimit: parseDefaultLimit(getSetting(db, 'defaultLimit'))
  }
}

export function getCurrentDataDir(): string {
  return getDataDir()
}

/**
 * Relocate the SQLite file to a new data dir, then repoint. Caller must reopen
 * the DB afterward (openDb()). Copies the file so the move is non-destructive.
 */
export function relocateDataDir(newDir: string): void {
  const from = join(getDataDir(), DB_FILENAME)
  const to = join(newDir, DB_FILENAME)
  closeDb()
  mkdirSync(newDir, { recursive: true })
  if (existsSync(from) && from !== to) copyFileSync(from, to) // copy data BEFORE repointing
  setDataDir(newDir) // repoint only after the copy succeeds, so a crash can't orphan the data
}
