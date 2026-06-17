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
      ssh_json    TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secrets (
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      secret_key    TEXT NOT NULL DEFAULT 'db',
      ciphertext    BLOB NOT NULL,
      PRIMARY KEY (connection_id, secret_key)
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
    CREATE TABLE IF NOT EXISTS saved_queries (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      query         TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_conn ON saved_queries(connection_id, name COLLATE NOCASE, id);
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_tabs (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      text          TEXT NOT NULL,
      position      INTEGER NOT NULL,
      active        INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS llm_conversations (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_conv ON llm_conversations(connection_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS llm_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES llm_conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_msg ON llm_messages(conversation_id, created_at);
  `)
  // Mongo Atlas / replica-set connectivity (added after first release of the schema).
  addColumnIfMissing(db, 'connections', 'auth_source', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing(db, 'connections', 'replica_set', "TEXT NOT NULL DEFAULT ''")
  // SSH tunnel config (added later): nullable JSON blob of SshConfig.
  addColumnIfMissing(db, 'connections', 'ssh_json', 'TEXT')
  // Editable-results commit safety (added later): default ON = require explicit commit.
  addColumnIfMissing(db, 'connections', 'require_commit', 'INTEGER NOT NULL DEFAULT 1')
  migrateSecretsCompositeKey(db)
}

/** Old DBs have secrets keyed by connection_id alone. Rebuild into the composite
 *  (connection_id, secret_key) shape, tagging existing rows as the 'db' password. */
function migrateSecretsCompositeKey(db: DB): void {
  const cols = db.prepare(`SELECT name FROM pragma_table_info('secrets')`).all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'secret_key')) return // fresh (composite) or already migrated
  db.exec(`
    CREATE TABLE secrets_new (
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      secret_key    TEXT NOT NULL DEFAULT 'db',
      ciphertext    BLOB NOT NULL,
      PRIMARY KEY (connection_id, secret_key)
    );
    INSERT INTO secrets_new (connection_id, secret_key, ciphertext)
      SELECT connection_id, 'db', ciphertext FROM secrets;
    DROP TABLE secrets;
    ALTER TABLE secrets_new RENAME TO secrets;
  `)
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
