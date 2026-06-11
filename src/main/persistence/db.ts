import type Database from 'better-sqlite3'
import { getDbPath } from './paths'

export type DB = Database.Database

/** ALTER TABLE ADD COLUMN, skipped if the column already exists. Keeps migrate() idempotent
 *  for databases created before the column was added to CREATE TABLE. The DDL is built from
 *  `column` itself so the existence check can never drift from the column actually added. */
function addColumnIfMissing(db: DB, table: string, column: string, spec: string): void {
  const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`)
}

/** Create all tables if absent, then patch older schemas up to date. Idempotent. */
export function migrate(db: DB): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
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
      auth_source TEXT NOT NULL DEFAULT '',
      replica_set TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secrets (
      connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
      ciphertext    BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS query_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      query         TEXT NOT NULL,
      ran_at        INTEGER NOT NULL,
      duration_ms   INTEGER,
      success       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_history_conn ON query_history(connection_id, ran_at DESC);
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  // Mongo Atlas / replica-set connectivity (added after first release of the schema).
  addColumnIfMissing(db, 'connections', 'auth_source', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing(db, 'connections', 'replica_set', "TEXT NOT NULL DEFAULT ''")
}

let singleton: DB | null = null

/** Open (once) the on-disk database at the current data dir and migrate it. */
export function openDb(): DB {
  if (singleton) return singleton
  // Lazy-load the native addon so it stays OUT of the main-process startup path
  // (it loads only on first DB use). Keeps the app launchable until the Electron
  // ABI rebuild lands in Plan 4; Node-based tests construct their own Database.
  const DatabaseCtor = require('better-sqlite3') as new (path: string) => DB
  singleton = new DatabaseCtor(getDbPath())
  migrate(singleton)
  return singleton
}

/** Close and forget the singleton (used when relocating the data dir). */
export function closeDb(): void {
  singleton?.close()
  singleton = null
}
