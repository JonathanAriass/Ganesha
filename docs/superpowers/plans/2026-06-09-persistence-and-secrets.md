# Persistence & Secrets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a local persistence layer — a SQLite store for connection configs, query history, and settings; OS-encrypted secret storage for passwords; and a configurable data directory — all reachable from the renderer over a newly type-safe IPC boundary. No real database connections yet (that's Plan 3) and no real UI (that's Plan 4): everything here is verified by unit tests.

**Architecture:** All persistence lives in the **main** process under `src/main/persistence/`. A single better-sqlite3 database (`db-client.sqlite`) holds `connections`, `query_history`, and `settings`; passwords are encrypted with Electron `safeStorage` and stored as a BLOB in a `secrets` table. The SQLite file lives in a **configurable data directory**, located via a tiny fixed pointer file in Electron `userData`. Services (`connections`, `secrets`, `history`, `settings`) are plain modules that take a `Database` (and, for secrets, an injected `Encryptor`) so they unit-test without an Electron runtime. The renderer reaches them through a **typed IPC contract** (`IpcChannels` map + `invoke<K>` / `handle<K>` wrappers) that makes every channel compiler-checked.

**Tech Stack:** better-sqlite3 (native, prebuilt), Electron `safeStorage`, Vitest, plus ESLint + Prettier + a minimal CI added at the end.

**This is Plan 2 of 4** (Foundation ✓ → **Persistence & Secrets** → Database Drivers → UI). Builds on `main` after Plan 1.

---

## File Structure (created/modified by this plan)

```
src/shared/
  ipc.ts            MODIFY — replace single-channel types with an IpcChannels contract map
  domain.ts         CREATE — shared domain types (ConnectionInput, ConnectionSummary, HistoryEntry, AppSettings, ...)
  api.ts            MODIFY — DbClientApi gains connections/history/settings methods
src/main/
  ipc.ts            MODIFY — typed handle<K>() registration + register all service handlers
  persistence/
    paths.ts        CREATE — data-dir pointer (userData/config.json) + resolve dbPath
    db.ts           CREATE — open better-sqlite3 + run migrations (schema)
    connections.ts  CREATE — connection config CRUD
    secrets.ts      CREATE — Encryptor interface + safeStorage impl + secret store (set/get/delete)
    history.ts      CREATE — query history add/list
    settings.ts     CREATE — key/value settings + data-dir get/relocate
src/preload/
  index.ts          MODIFY — typed invoke<K>() + implement the new DbClientApi methods
  index.d.ts        DELETE — consolidate the duplicate Window.api global into the renderer's env.d.ts
src/renderer/src/
  env.d.ts          (unchanged — remains the single Window.api declaration)
.eslintrc.cjs        CREATE — lint config incl. the renderer-cannot-import-main boundary rule
.prettierrc.json     CREATE
.github/workflows/ci.yml  CREATE — typecheck + test on push
package.json         MODIFY — add deps + lint scripts
tests live next to code as src/main/persistence/*.test.ts and src/shared/*.test.ts
```

**Boundary rule (still enforced):** `src/renderer` imports only `src/shared` types + `window.api`. `safeStorage`/better-sqlite3/`fs` appear only under `src/main`.

---

## Task 1: Typed IPC wrapper + consolidate the `Window.api` global

The final review of Plan 1 flagged that `ipcRenderer.invoke`/`ipcMain.handle` are `any`-typed, so the `Result<T>` safety is asserted, not enforced. Fix that **before** the API surface grows. We introduce one channel-contract map and typed `invoke`/`handle` helpers, then refactor the existing `ping` onto them so nothing else changes behaviorally.

**Files:** Modify `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`; delete `src/preload/index.d.ts`.

- [ ] **Step 1: Write the failing test** `src/shared/ipc.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest'
import type { IpcChannels, ChannelName } from './ipc'
import type { Result } from './result'

describe('IPC contract', () => {
  it('ping channel maps string request to PingPayload response', () => {
    expectTypeOf<IpcChannels['ping']['req']>().toEqualTypeOf<string>()
    expectTypeOf<IpcChannels['ping']['res']>().toMatchTypeOf<{ pong: string }>()
  })
  it('ChannelName is the union of channel keys', () => {
    expectTypeOf<'ping'>().toMatchTypeOf<ChannelName>()
  })
  it('every channel response is wrappable in Result', () => {
    type R = Result<IpcChannels['ping']['res']>
    expectTypeOf<R>().toMatchTypeOf<{ ok: boolean }>()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run src/shared/ipc.test.ts`
Expected: FAIL — `IpcChannels`/`ChannelName` not exported yet.

- [ ] **Step 3: Rewrite `src/shared/ipc.ts`** to the contract-map form:

```ts
import type { Result } from './result'

export interface PingPayload {
  pong: string
}

/**
 * The single source of truth for IPC channels. Each key is a channel name;
 * `req` is the renderer→main argument type, `res` is the success payload
 * (always delivered wrapped in Result<res> by the typed invoke/handle helpers).
 * New channels are added here in later tasks.
 */
export interface IpcChannels {
  ping: { req: string; res: PingPayload }
}

export type ChannelName = keyof IpcChannels
export type Req<K extends ChannelName> = IpcChannels[K]['req']
export type Res<K extends ChannelName> = IpcChannels[K]['res']
export type IpcResult<K extends ChannelName> = Result<Res<K>>
```

- [ ] **Step 4: Run the type test to verify it passes.** Run: `npx vitest run src/shared/ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `src/preload/index.ts`** with a typed `invoke`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ChannelName, Req, IpcResult } from '../shared/ipc'
import type { DbClientApi } from '../shared/api'

function invoke<K extends ChannelName>(channel: K, req: Req<K>): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, req)
}

const api: DbClientApi = {
  ping: (message) => invoke('ping', message)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 6: Rewrite `src/main/ipc.ts`** with a typed `handle` that wraps thrown errors in `err()`:

```ts
import { ipcMain } from 'electron'
import type { ChannelName, Req, Res } from '../shared/ipc'
import { ok, err, type Result } from '../shared/result'

type Handler<K extends ChannelName> = (req: Req<K>) => Result<Res<K>> | Promise<Result<Res<K>>>

/** Register a single typed channel handler; any thrown error becomes err(message). */
export function handle<K extends ChannelName>(channel: K, fn: Handler<K>): void {
  ipcMain.handle(channel, async (_event, req: Req<K>) => {
    try {
      return await fn(req)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })
}

/** Register every main-process IPC handler. Called once on app ready. */
export function registerIpcHandlers(): void {
  handle('ping', (message) => ok({ pong: message }))
}
```

- [ ] **Step 7: Update `src/shared/api.ts`** to use the contract types (keeps one source of truth):

```ts
import type { IpcResult } from './ipc'

export interface DbClientApi {
  ping(message: string): Promise<IpcResult<'ping'>>
}
```

- [ ] **Step 8: Consolidate the duplicate global.** Delete `src/preload/index.d.ts` (the renderer's `src/renderer/src/env.d.ts` remains the single `Window.api` declaration; the preload doesn't consume its own `.d.ts` at runtime). Run: `git rm src/preload/index.d.ts`.

- [ ] **Step 9: Verify gates.** Run: `npm run typecheck && npm test`
Expected: both PASS (ping still typechecks end-to-end; result tests + new ipc type test green).

- [ ] **Step 10: Commit.**
```bash
git add -A
git commit -m "refactor: type the IPC boundary with an IpcChannels contract and invoke/handle helpers"
```

---

## Task 2: better-sqlite3 store — data-dir pointer, open, and migrations

**Files:** Modify `package.json`; create `src/main/persistence/paths.ts`, `src/main/persistence/db.ts`, and `src/main/persistence/db.test.ts`.

- [ ] **Step 1: Add the dependency.** Run: `npm install better-sqlite3@^11.3.0 && npm install -D @types/better-sqlite3@^7.6.11`
Expected: installs cleanly (better-sqlite3 ships prebuilt binaries).

- [ ] **Step 2: Create `src/main/persistence/paths.ts`** — locates the data dir via a fixed pointer file so the data dir itself is relocatable:

```ts
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
```

- [ ] **Step 3: Write the failing test** `src/main/persistence/db.test.ts` (uses an in-memory DB so it needs no Electron/userData):

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from './db'

describe('migrate', () => {
  it('creates the expected tables', () => {
    const db = new Database(':memory:')
    migrate(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name)
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
```

- [ ] **Step 4: Run it to verify it fails.** Run: `npx vitest run src/main/persistence/db.test.ts`
Expected: FAIL — `./db` has no `migrate` export.

- [ ] **Step 5: Create `src/main/persistence/db.ts`:**

```ts
import Database from 'better-sqlite3'
import { getDbPath } from './paths'

export type DB = Database.Database

/** Create all tables if absent. Idempotent. */
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
}

let singleton: DB | null = null

/** Open (once) the on-disk database at the current data dir and migrate it. */
export function openDb(): DB {
  if (singleton) return singleton
  singleton = new Database(getDbPath())
  migrate(singleton)
  return singleton
}

/** Close and forget the singleton (used when relocating the data dir). */
export function closeDb(): void {
  singleton?.close()
  singleton = null
}
```

- [ ] **Step 6: Run the test to verify it passes.** Run: `npx vitest run src/main/persistence/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit.**
```bash
git add -A
git commit -m "feat: add better-sqlite3 store with schema migrations and relocatable data dir"
```

---

## Task 3: Connections service (CRUD)

**Files:** Create `src/shared/domain.ts`, `src/main/persistence/connections.ts`, `src/main/persistence/connections.test.ts`.

- [ ] **Step 1: Create `src/shared/domain.ts`** (shared domain types — no runtime code, safe for renderer):

```ts
export type ConnectionType = 'postgres' | 'mysql' | 'mariadb' | 'mongodb'

/** Fields the user supplies when creating/editing a connection (no password here). */
export interface ConnectionInput {
  type: ConnectionType
  name: string
  color: string
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  readOnly: boolean
}

/** A stored connection (input + identity + timestamps), password excluded. */
export interface ConnectionConfig extends ConnectionInput {
  id: string
  createdAt: number
  updatedAt: number
}

export interface HistoryEntryInput {
  connectionId: string
  query: string
  ranAt: number
  durationMs: number | null
  success: boolean | null
}

export interface HistoryEntry extends HistoryEntryInput {
  id: number
}

export interface AppSettings {
  theme: 'midnight' | 'light'
}

export const DEFAULT_SETTINGS: AppSettings = { theme: 'midnight' }
```

- [ ] **Step 2: Write the failing test** `src/main/persistence/connections.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it to verify it fails.** Run: `npx vitest run src/main/persistence/connections.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 4: Create `src/main/persistence/connections.ts`:**

```ts
import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { ConnectionConfig, ConnectionInput } from '../../shared/domain'

interface Row {
  id: string; type: string; name: string; color: string; host: string; port: number
  username: string; db_name: string; ssl: number; read_only: number
  created_at: number; updated_at: number
}

function toConfig(r: Row): ConnectionConfig {
  return {
    id: r.id, type: r.type as ConnectionConfig['type'], name: r.name, color: r.color,
    host: r.host, port: r.port, username: r.username, database: r.db_name,
    ssl: !!r.ssl, readOnly: !!r.read_only, createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export function createConnection(db: DB, input: ConnectionInput, now: number): ConnectionConfig {
  const id = randomUUID()
  db.prepare(`INSERT INTO connections
    (id,type,name,color,host,port,username,db_name,ssl,read_only,created_at,updated_at)
    VALUES (@id,@type,@name,@color,@host,@port,@username,@database,@ssl,@readOnly,@now,@now)`)
    .run({ id, ...input, ssl: input.ssl ? 1 : 0, readOnly: input.readOnly ? 1 : 0, now })
  return getConnection(db, id) as ConnectionConfig
}

export function listConnections(db: DB): ConnectionConfig[] {
  return (db.prepare('SELECT * FROM connections ORDER BY created_at DESC').all() as Row[]).map(toConfig)
}

export function getConnection(db: DB, id: string): ConnectionConfig | null {
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Row | undefined
  return row ? toConfig(row) : null
}

export function updateConnection(db: DB, id: string, patch: Partial<ConnectionInput>, now: number): ConnectionConfig {
  const current = getConnection(db, id)
  if (!current) throw new Error(`Connection not found: ${id}`)
  const next = { ...current, ...patch }
  db.prepare(`UPDATE connections SET
    type=@type,name=@name,color=@color,host=@host,port=@port,username=@username,
    db_name=@database,ssl=@ssl,read_only=@readOnly,updated_at=@now WHERE id=@id`)
    .run({ ...next, id, ssl: next.ssl ? 1 : 0, readOnly: next.readOnly ? 1 : 0, now })
  return getConnection(db, id) as ConnectionConfig
}

export function deleteConnection(db: DB, id: string): void {
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
}
```

- [ ] **Step 5: Run the test to verify it passes.** Run: `npx vitest run src/main/persistence/connections.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "feat: add connection config CRUD service"
```

---

## Task 4: Secret store (injected encryptor, safeStorage in prod)

`safeStorage` only exists in a running Electron app, so the store takes an `Encryptor` interface; tests inject a fake, production injects the safeStorage-backed one. Encrypted blobs are stored in the `secrets` table.

**Files:** Create `src/main/persistence/secrets.ts`, `src/main/persistence/secrets.test.ts`.

- [ ] **Step 1: Write the failing test** `src/main/persistence/secrets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection } from './connections'
import { makeSecretStore, type Encryptor } from './secrets'
import type { ConnectionInput } from '../../shared/domain'

// Reversible fake encryptor: prove the store round-trips without relying on the OS.
const fake: Encryptor = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decrypt: (buf) => buf.toString('utf8').replace(/^enc:/, '')
}
const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false
}

let db: DB
let store: ReturnType<typeof makeSecretStore>
beforeEach(() => {
  db = new Database(':memory:'); migrate(db)
  store = makeSecretStore(db, fake)
})

describe('secret store', () => {
  it('stores and retrieves a password (encrypted at rest)', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 's3cret')
    const raw = db.prepare('SELECT ciphertext FROM secrets WHERE connection_id=?').get(c.id) as { ciphertext: Buffer }
    expect(raw.ciphertext.toString('utf8')).toBe('enc:s3cret') // not plaintext
    expect(store.getPassword(c.id)).toBe('s3cret')
  })

  it('returns null when no password is stored', () => {
    const c = createConnection(db, input, 1)
    expect(store.getPassword(c.id)).toBeNull()
  })

  it('overwrites an existing password', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'a'); store.setPassword(c.id, 'b')
    expect(store.getPassword(c.id)).toBe('b')
  })

  it('deletes a password', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'x'); store.deletePassword(c.id)
    expect(store.getPassword(c.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run src/main/persistence/secrets.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Create `src/main/persistence/secrets.ts`:**

```ts
import type { DB } from './db'

/** Abstraction over Electron safeStorage so the store is unit-testable. */
export interface Encryptor {
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}

/** Production encryptor backed by Electron's OS-keyed safeStorage. */
export function safeStorageEncryptor(): Encryptor {
  // Imported lazily so this file can be imported in tests without Electron.
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext)
  }
}

export function makeSecretStore(db: DB, enc: Encryptor) {
  return {
    setPassword(connectionId: string, password: string): void {
      db.prepare(
        `INSERT INTO secrets (connection_id, ciphertext) VALUES (?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET ciphertext = excluded.ciphertext`
      ).run(connectionId, enc.encrypt(password))
    },
    getPassword(connectionId: string): string | null {
      const row = db.prepare('SELECT ciphertext FROM secrets WHERE connection_id = ?')
        .get(connectionId) as { ciphertext: Buffer } | undefined
      return row ? enc.decrypt(row.ciphertext) : null
    },
    deletePassword(connectionId: string): void {
      db.prepare('DELETE FROM secrets WHERE connection_id = ?').run(connectionId)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/main/persistence/secrets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "feat: add safeStorage-backed secret store with injectable encryptor"
```

---

## Task 5: Query history service

**Files:** Create `src/main/persistence/history.ts`, `src/main/persistence/history.test.ts`.

- [ ] **Step 1: Write the failing test** `src/main/persistence/history.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection } from './connections'
import { addHistory, listHistory } from './history'
import type { ConnectionInput } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false
}
let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('history service', () => {
  it('adds an entry and reads it back with an id', () => {
    const c = createConnection(db, input, 1)
    const e = addHistory(db, { connectionId: c.id, query: 'SELECT 1', ranAt: 10, durationMs: 5, success: true })
    expect(e.id).toBeGreaterThan(0)
    expect(listHistory(db, c.id)).toEqual([e])
  })

  it('lists newest-first and respects limit', () => {
    const c = createConnection(db, input, 1)
    addHistory(db, { connectionId: c.id, query: 'a', ranAt: 10, durationMs: null, success: null })
    addHistory(db, { connectionId: c.id, query: 'b', ranAt: 20, durationMs: null, success: null })
    expect(listHistory(db, c.id, 1).map((e) => e.query)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run src/main/persistence/history.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Create `src/main/persistence/history.ts`:**

```ts
import type { DB } from './db'
import type { HistoryEntry, HistoryEntryInput } from '../../shared/domain'

interface Row {
  id: number; connection_id: string; query: string
  ran_at: number; duration_ms: number | null; success: number | null
}
function toEntry(r: Row): HistoryEntry {
  return {
    id: r.id, connectionId: r.connection_id, query: r.query, ranAt: r.ran_at,
    durationMs: r.duration_ms, success: r.success === null ? null : !!r.success
  }
}

export function addHistory(db: DB, e: HistoryEntryInput): HistoryEntry {
  const info = db.prepare(
    `INSERT INTO query_history (connection_id, query, ran_at, duration_ms, success)
     VALUES (@connectionId, @query, @ranAt, @durationMs, @success)`
  ).run({ ...e, success: e.success === null ? null : e.success ? 1 : 0 })
  return toEntry(db.prepare('SELECT * FROM query_history WHERE id = ?').get(info.lastInsertRowid) as Row)
}

export function listHistory(db: DB, connectionId: string, limit = 100): HistoryEntry[] {
  return (db.prepare(
    'SELECT * FROM query_history WHERE connection_id = ? ORDER BY ran_at DESC, id DESC LIMIT ?'
  ).all(connectionId, limit) as Row[]).map(toEntry)
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/main/persistence/history.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "feat: add query history service"
```

---

## Task 6: Settings service + data-dir relocation

**Files:** Create `src/main/persistence/settings.ts`, `src/main/persistence/settings.test.ts`.

- [ ] **Step 1: Write the failing test** `src/main/persistence/settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run src/main/persistence/settings.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Create `src/main/persistence/settings.ts`** (the key/value table backs a typed `AppSettings`; data-dir relocation lives here too):

```ts
import { copyFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { DB } from './db'
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/domain'
import { getDataDir, setDataDir, DB_FILENAME } from './paths'
import { closeDb } from './db'

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

function readSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

/** Build the typed AppSettings from the key/value rows, falling back to defaults. */
export function getSettings(db: DB): AppSettings {
  const theme = readSetting(db, 'theme')
  return { theme: theme === 'light' ? 'light' : DEFAULT_SETTINGS.theme }
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
  setDataDir(newDir) // creates newDir
  if (existsSync(from) && from !== to) copyFileSync(from, to)
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/main/persistence/settings.test.ts`
Expected: PASS (3 tests). (Relocation is covered by the integration smoke in Task 8; it needs the Electron `app` path, so it isn't unit-tested here.)

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "feat: add typed settings service and data-dir relocation"
```

---

## Task 7: Wire the services to the renderer over typed IPC

Add channels to the contract, register handlers, and expose typed methods on `window.api`. A single `getStore()` helper in `ipc.ts` opens the DB and builds the secret store with the real encryptor.

**Files:** Modify `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`.

- [ ] **Step 1: Extend `IpcChannels` in `src/shared/ipc.ts`** — add these entries to the existing interface (keep `ping`):

```ts
import type {
  ConnectionConfig, ConnectionInput, HistoryEntry, HistoryEntryInput, AppSettings
} from './domain'

// inside IpcChannels { ... } add:
  'connections.list': { req: void; res: ConnectionConfig[] }
  'connections.get': { req: string; res: ConnectionConfig | null }
  'connections.create': { req: { input: ConnectionInput; password: string | null }; res: ConnectionConfig }
  'connections.update': { req: { id: string; patch: Partial<ConnectionInput>; password?: string | null }; res: ConnectionConfig }
  'connections.delete': { req: string; res: null }
  'history.add': { req: HistoryEntryInput; res: HistoryEntry }
  'history.list': { req: { connectionId: string; limit?: number }; res: HistoryEntry[] }
  'settings.get': { req: void; res: AppSettings }
  'settings.set': { req: { key: string; value: string }; res: AppSettings }
  'settings.dataDir.get': { req: void; res: string }
  'settings.dataDir.set': { req: string; res: string }
```

- [ ] **Step 2: Extend `DbClientApi` in `src/shared/api.ts`:**

```ts
import type { IpcResult } from './ipc'
import type { ConnectionConfig, ConnectionInput, HistoryEntry, HistoryEntryInput, AppSettings } from './domain'

export interface DbClientApi {
  ping(message: string): Promise<IpcResult<'ping'>>
  connections: {
    list(): Promise<IpcResult<'connections.list'>>
    get(id: string): Promise<IpcResult<'connections.get'>>
    create(input: ConnectionInput, password: string | null): Promise<IpcResult<'connections.create'>>
    update(id: string, patch: Partial<ConnectionInput>, password?: string | null): Promise<IpcResult<'connections.update'>>
    delete(id: string): Promise<IpcResult<'connections.delete'>>
  }
  history: {
    add(entry: HistoryEntryInput): Promise<IpcResult<'history.add'>>
    list(connectionId: string, limit?: number): Promise<IpcResult<'history.list'>>
  }
  settings: {
    get(): Promise<IpcResult<'settings.get'>>
    set(key: string, value: string): Promise<IpcResult<'settings.set'>>
    getDataDir(): Promise<IpcResult<'settings.dataDir.get'>>
    setDataDir(dir: string): Promise<IpcResult<'settings.dataDir.set'>>
  }
}
```

- [ ] **Step 3: Implement the methods in `src/preload/index.ts`** (keep the typed `invoke`; add the grouped api):

```ts
const api: DbClientApi = {
  ping: (message) => invoke('ping', message),
  connections: {
    list: () => invoke('connections.list', undefined),
    get: (id) => invoke('connections.get', id),
    create: (input, password) => invoke('connections.create', { input, password }),
    update: (id, patch, password) => invoke('connections.update', { id, patch, password }),
    delete: (id) => invoke('connections.delete', id)
  },
  history: {
    add: (entry) => invoke('history.add', entry),
    list: (connectionId, limit) => invoke('history.list', { connectionId, limit })
  },
  settings: {
    get: () => invoke('settings.get', undefined),
    set: (key, value) => invoke('settings.set', { key, value }),
    getDataDir: () => invoke('settings.dataDir.get', undefined),
    setDataDir: (dir) => invoke('settings.dataDir.set', dir)
  }
}
```

- [ ] **Step 4: Register handlers in `src/main/ipc.ts`** — replace `registerIpcHandlers` with one that wires every channel through the services. Add the imports and a `getStore()` helper:

```ts
import { ok } from '../shared/result'
import { openDb } from './persistence/db'
import { safeStorageEncryptor, makeSecretStore } from './persistence/secrets'
import * as conns from './persistence/connections'
import * as hist from './persistence/history'
import * as settings from './persistence/settings'

function now(): number {
  return Date.now()
}

/**
 * Resolve the CURRENT db + a secret store on every call. openDb() returns the
 * live singleton (reopened after any data-dir relocation), so handlers never
 * hold a stale/closed connection.
 */
function store(): { db: ReturnType<typeof openDb>; secrets: ReturnType<typeof makeSecretStore> } {
  const db = openDb()
  return { db, secrets: makeSecretStore(db, safeStorageEncryptor()) }
}

export function registerIpcHandlers(): void {
  handle('ping', (message) => ok({ pong: message }))

  handle('connections.list', () => ok(conns.listConnections(store().db)))
  handle('connections.get', (id) => ok(conns.getConnection(store().db, id)))
  handle('connections.create', ({ input, password }) => {
    const { db, secrets } = store()
    const c = conns.createConnection(db, input, now())
    if (password) secrets.setPassword(c.id, password)
    return ok(c)
  })
  handle('connections.update', ({ id, patch, password }) => {
    const { db, secrets } = store()
    const c = conns.updateConnection(db, id, patch, now())
    if (password !== undefined) {
      if (password === null) secrets.deletePassword(id)
      else secrets.setPassword(id, password)
    }
    return ok(c)
  })
  handle('connections.delete', (id) => { conns.deleteConnection(store().db, id); return ok(null) })

  handle('history.add', (entry) => ok(hist.addHistory(store().db, entry)))
  handle('history.list', ({ connectionId, limit }) => ok(hist.listHistory(store().db, connectionId, limit)))

  handle('settings.get', () => ok(settings.getSettings(store().db)))
  handle('settings.set', ({ key, value }) => {
    const { db } = store()
    settings.setSetting(db, key, value)
    return ok(settings.getSettings(db))
  })
  handle('settings.dataDir.get', () => ok(settings.getCurrentDataDir()))
  handle('settings.dataDir.set', (dir) => { settings.relocateDataDir(dir); openDb(); return ok(dir) })
}
```

> Note: `getPassword` is intentionally **not** exposed over IPC — passwords leave main only when Plan 3's drivers connect. The renderer can set/clear a password but never read it back.

- [ ] **Step 5: Verify gates.** Run: `npm run typecheck && npm test`
Expected: both PASS (all persistence unit tests + type-checked IPC surface).

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "feat: expose persistence services to the renderer over typed IPC"
```

---

## Task 8: Lint, format, CI, and final verification

**Files:** Create `.eslintrc.cjs`, `.prettierrc.json`, `.github/workflows/ci.yml`; modify `package.json`.

- [ ] **Step 1: Install lint/format deps.** Run:
```bash
npm install -D eslint@^8.57.0 @typescript-eslint/parser@^7.18.0 @typescript-eslint/eslint-plugin@^7.18.0 eslint-plugin-react-hooks@^4.6.2 eslint-config-prettier@^9.1.0 prettier@^3.3.3
```

- [ ] **Step 2: Create `.eslintrc.cjs`** — includes the boundary rule that forbids the renderer from importing main:

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['out/', 'dist/', 'node_modules/', '*.cjs'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn'
  },
  overrides: [
    {
      files: ['src/renderer/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{ group: ['**/main/**', '../main/*', 'electron'],
            message: 'Renderer must not import from main or electron — use window.api.' }]
        }]
      }
    }
  ]
}
```

- [ ] **Step 3: Create `.prettierrc.json`:**

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "none"
}
```

- [ ] **Step 4: Add scripts to `package.json`** (`scripts` block):

```json
"lint": "eslint . --ext .ts,.tsx",
"format": "prettier --write \"src/**/*.{ts,tsx}\""
```

- [ ] **Step 5: Create `.github/workflows/ci.yml`:**

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 6: Run lint and fix any violations.** Run: `npm run lint`
Expected: PASS (no errors). If the boundary rule or recommended rules flag anything in `src/`, fix it minimally (or run `npm run format` for stylistic issues) and re-run until clean.

- [ ] **Step 7: Full gate.** Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 8: Dev smoke (manual, optional but recommended).** Run `npm run dev`; the existing shell still shows "IPC ok: hello" (persistence runs lazily on first call and must not break startup). Quit the app. If startup errors appear (e.g. better-sqlite3 native load under Electron), report it — better-sqlite3 may need `electron-rebuild`; if so, add `"postinstall": "electron-builder install-app-deps"` to package.json and re-run.

- [ ] **Step 9: Commit.**
```bash
git add -A
git commit -m "build: add ESLint, Prettier, and CI; enforce renderer/main import boundary"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** connection persistence (CRUD + SSL/readOnly/color fields) ✓ T3; passwords never in plaintext (safeStorage, encrypted BLOB, never read back over IPC) ✓ T4; query history ✓ T5; configurable data dir + theme setting ✓ T6; all reachable from the renderer ✓ T7. Drivers/connect/test are correctly deferred to Plan 3; real UI to Plan 4.
- **Placeholder scan:** none — every step has full code and exact commands.
- **Type consistency:** `ConnectionInput`/`ConnectionConfig`/`HistoryEntry(Input)`/`AppSettings` are defined once in `shared/domain.ts` and reused across services, IPC contract, and api; the `IpcChannels` keys used in `handle()`/`invoke()`/`DbClientApi` match exactly; `migrate`/`openDb`/`closeDb`/`DB` line up across db/settings/ipc.

## Definition of Done

`npm run typecheck`, `npm run lint`, and `npm test` all pass (connections, secrets, history, settings, db, and ipc-type tests green), the dev app still starts and shows "IPC ok: hello", and the renderer can list/create/update/delete connections, append/list history, and read/write settings + data dir entirely through the typed `window.api`. On green → **Plan 3 — Database Drivers**.
```
