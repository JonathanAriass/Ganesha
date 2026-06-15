import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const POINTER_FILE = 'data-location.json'
export const DB_FILENAME = 'db-client.sqlite'

/** Electron userData dir, resolved lazily via require so this module imports cleanly under Node/Vitest. */
function userDataDir(): string {
  const { app } = require('electron') as typeof import('electron')
  return app.getPath('userData')
}

/** The fixed userData path that records where the (relocatable) data dir lives. */
function pointerPath(): string {
  return join(userDataDir(), POINTER_FILE)
}

/** Current data directory (defaults to userData on first run). */
export function getDataDir(): string {
  const pointer = pointerPath()
  if (existsSync(pointer)) {
    const parsed = JSON.parse(readFileSync(pointer, 'utf8')) as { dataDir?: string }
    if (parsed.dataDir) return parsed.dataDir
  }
  return userDataDir()
}

/** Persist a new data directory location (creates it if needed). */
export function setDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(pointerPath(), JSON.stringify({ dataDir: dir }, null, 2))
}

/** Absolute path to the SQLite file inside the current data dir. */
export function getDbPath(): string {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  return join(dir, DB_FILENAME)
}

/** Directory holding downloaded GGUF models, under the current data dir. */
export function getModelsDir(): string {
  const dir = join(getDataDir(), 'models')
  mkdirSync(dir, { recursive: true })
  return dir
}
