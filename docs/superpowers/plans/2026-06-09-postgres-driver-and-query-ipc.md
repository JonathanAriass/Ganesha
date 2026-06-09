# Postgres Driver & Query IPC Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app connect to a real PostgreSQL database and run a query end-to-end — the first concrete `DatabaseDriver`, the driver registry, server-side read-only enforcement, and the IPC query pipeline that resolves a saved connection + its secret, runs the query through the read-only guard, logs it to history, and returns a normalized result. Verified against a real Postgres via testcontainers.

**Architecture:** `src/main/drivers/` gains `registry.ts` (a `DriverManager`) and `sql/postgres.ts` (`PostgresDriver implements DatabaseDriver`, using the pure-JS `pg` pool). The IPC layer (`src/main/ipc.ts`) gains a query pipeline that ties Plan 2 (connections + secrets + history) to Plan 3 (drivers + read-only guard): load config + password → build `ConnectParams` → `assertSqlWritable` → `driver.runQuery` (which ALSO wraps reads in a server-side `READ ONLY` transaction as defense-in-depth) → append history → return `QueryResult`. Integration tests run under a separate `test:integration` Vitest config so the fast unit suite stays unit-only.

**Tech Stack:** `pg` (pure-JS Postgres driver), `testcontainers` + `@testcontainers/postgresql` (Docker-backed integration, dev-only), Vitest.

**This is Plan 3b** (3a contract+safety ✓ → **3b Postgres + query IPC** → 3c MySQL → 3d Mongo+mongosh). Builds on `main` after Plan 3a. Docker must be running for the integration suite.

---

## File Structure

```
src/main/drivers/
  types.ts            MODIFY — add `readOnly: boolean` to RunOptions
  registry.ts         CREATE — DriverManager (register/get/has)
  registry.test.ts    CREATE
  sql/postgres.ts     CREATE — PostgresDriver implements DatabaseDriver
  sql/postgres.integration.test.ts  CREATE — testcontainers-backed
src/shared/
  ipc.ts              MODIFY — add query/test/cancel/disconnect channels
  api.ts              MODIFY — DbClientApi gains a `query` group
src/main/
  ipc.ts              MODIFY — DriverManager singleton + query pipeline handlers
  query-service.ts    CREATE — runQuery orchestration (config+secret+guard+driver+history); unit-tested with a fake driver
  query-service.test.ts CREATE
src/preload/index.ts  MODIFY — implement the query methods
vitest.config.ts      MODIFY — exclude *.integration.test.ts from the unit run
vitest.integration.config.ts  CREATE
package.json          MODIFY — deps + test:integration script
```

---

## Task 1: RunOptions.readOnly + DriverManager registry

**Files:** Modify `src/main/drivers/types.ts`; create `src/main/drivers/registry.ts`, `registry.test.ts`.

- [ ] **Step 1: Add `readOnly` to `RunOptions` in `src/main/drivers/types.ts`** — change the interface to:
```ts
export interface RunOptions {
  /** Hard cap on returned rows; the driver applies it and sets `truncated`. */
  maxRows: number
  /** Caller-supplied id so an in-flight query can be cancelled. */
  queryId: string
  /** When true, the driver ALSO enforces read-only at the server (defense-in-depth). */
  readOnly: boolean
}
```

- [ ] **Step 2: Write the failing test** `src/main/drivers/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DriverManager } from './registry'
import type { DatabaseDriver } from './types'

const fakePg = { type: 'postgres' } as unknown as DatabaseDriver

describe('DriverManager', () => {
  it('registers and retrieves a driver by type', () => {
    const m = new DriverManager()
    m.register(fakePg)
    expect(m.has('postgres')).toBe(true)
    expect(m.get('postgres')).toBe(fakePg)
  })
  it('throws a clear error for an unregistered type', () => {
    const m = new DriverManager()
    expect(m.has('mysql')).toBe(false)
    expect(() => m.get('mysql')).toThrow(/no driver/i)
  })
})
```

- [ ] **Step 3: Run it to verify it fails.** `npx vitest run src/main/drivers/registry.test.ts` → FAIL.

- [ ] **Step 4: Create `src/main/drivers/registry.ts`:**
```ts
import type { DatabaseDriver } from './types'
import type { ConnectionType } from '../../shared/domain'

/** Holds one driver instance per connection type and routes by type. */
export class DriverManager {
  private drivers = new Map<ConnectionType, DatabaseDriver>()

  register(driver: DatabaseDriver): void {
    this.drivers.set(driver.type, driver)
  }

  has(type: ConnectionType): boolean {
    return this.drivers.has(type)
  }

  get(type: ConnectionType): DatabaseDriver {
    const driver = this.drivers.get(type)
    if (!driver) throw new Error(`No driver registered for connection type '${type}'`)
    return driver
  }
}
```

- [ ] **Step 5: Run + verify.** `npx vitest run src/main/drivers/registry.test.ts` (PASS) + `npm run typecheck`.

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "feat: add RunOptions.readOnly and the DriverManager registry"
```

---

## Task 2: PostgresDriver

**Files:** Modify `package.json` (add `pg`); create `src/main/drivers/sql/postgres.ts`.

- [ ] **Step 1: Add the dependency.** Run: `npm install pg@^8.12.0 && npm install -D @types/pg@^8.11.6`

- [ ] **Step 2: Create `src/main/drivers/sql/postgres.ts`:**
```ts
import pg from 'pg'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta
} from '../types'

const { Pool } = pg

/** PostgreSQL driver backed by a per-connection pg.Pool. */
export class PostgresDriver implements DatabaseDriver {
  readonly type = 'postgres' as const
  private pools = new Map<string, pg.Pool>()
  private running = new Map<string, number>() // queryId -> backend pid

  private poolConfig(p: ConnectParams): pg.PoolConfig {
    return {
      host: p.host,
      port: p.port,
      user: p.username,
      password: p.password ?? undefined,
      database: p.database,
      ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000
    }
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const pool = new Pool(this.poolConfig(p))
    try {
      await pool.query('SELECT 1')
    } finally {
      await pool.end()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    if (!this.pools.has(p.id)) this.pools.set(p.id, new Pool(this.poolConfig(p)))
  }

  async disconnect(id: string): Promise<void> {
    const pool = this.pools.get(id)
    if (pool) {
      this.pools.delete(id)
      await pool.end()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'sql') throw new Error('PostgresDriver handles only SQL requests')
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)

    const client = await pool.connect()
    const pid = (client as unknown as { processID: number }).processID
    this.running.set(opts.queryId, pid)
    const start = Date.now()
    try {
      if (opts.readOnly) await client.query('BEGIN TRANSACTION READ ONLY')
      const res = await client.query({ text: request.sql, rowMode: 'array' })
      if (opts.readOnly) await client.query('COMMIT')

      const fields = res.fields ?? []
      const columns: ColumnMeta[] = fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) }))
      const allRows = (res.rows as unknown as unknown[][]) ?? []
      const truncated = allRows.length > opts.maxRows
      const rows = truncated ? allRows.slice(0, opts.maxRows) : allRows
      return {
        columns,
        rows,
        rowCount: typeof res.rowCount === 'number' ? res.rowCount : rows.length,
        durationMs: Date.now() - start,
        truncated,
        documents: null
      }
    } catch (e) {
      if (opts.readOnly) {
        try {
          await client.query('ROLLBACK')
        } catch {
          /* already aborted */
        }
      }
      throw e
    } finally {
      this.running.delete(opts.queryId)
      client.release()
    }
  }

  async cancel(id: string, queryId: string): Promise<void> {
    const pid = this.running.get(queryId)
    const pool = this.pools.get(id)
    if (pid && pool) await pool.query('SELECT pg_cancel_backend($1)', [pid])
  }
}
```

> Notes (intentional v1 scope): `dataType` is the type OID as a string — mapping OIDs to friendly names is a later polish. Multi-statement results return pg's last result. Both are fine for the slice.

- [ ] **Step 3: Verify.** `npm run typecheck && npm run lint` (clean). (Behavior is verified by the integration test in Task 3.)

- [ ] **Step 4: Commit.**
```bash
git add -A
git commit -m "feat: add PostgresDriver (pool, normalized results, server-side read-only, cancel)"
```

---

## Task 3: Postgres integration test (testcontainers)

**Files:** Modify `package.json`, `vitest.config.ts`; create `vitest.integration.config.ts`, `src/main/drivers/sql/postgres.integration.test.ts`. **Requires Docker running.**

- [ ] **Step 1: Add deps.** Run: `npm install -D testcontainers@^10.13.0 @testcontainers/postgresql@^10.13.0`

- [ ] **Step 2: Exclude integration tests from the unit run.** In `vitest.config.ts`, change `include`/`exclude` so the default run skips `*.integration.test.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'out', 'dist', 'src/**/*.integration.test.ts']
  }
})
```

- [ ] **Step 3: Create `vitest.integration.config.ts`:**
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000
  }
})
```

- [ ] **Step 4: Add the script to `package.json`:**
```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 5: Create `src/main/drivers/sql/postgres.integration.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PostgresDriver } from './postgres'
import type { ConnectParams } from '../types'

describe('PostgresDriver (integration, requires Docker)', () => {
  let container: StartedPostgreSqlContainer
  const driver = new PostgresDriver()
  const id = 'itest'

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
    const params: ConnectParams = {
      id,
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
      ssl: false
    }
    await driver.connect(params)
  })

  afterAll(async () => {
    await driver.disconnect(id)
    await container?.stop()
  })

  it('runs a SELECT and returns a normalized, column-aligned result', async () => {
    const res = await driver.runQuery(
      id,
      { kind: 'sql', sql: "SELECT 1 AS n, 'hi' AS s" },
      { maxRows: 1000, queryId: 'q1', readOnly: false }
    )
    expect(res.columns.map((c) => c.name)).toEqual(['n', 's'])
    expect(res.rows).toEqual([[1, 'hi']])
    expect(res.rowCount).toBe(1)
    expect(res.truncated).toBe(false)
    expect(res.documents).toBeNull()
  })

  it('caps rows at maxRows and flags truncated', async () => {
    const res = await driver.runQuery(
      id,
      { kind: 'sql', sql: 'SELECT generate_series(1, 100) AS n' },
      { maxRows: 10, queryId: 'q2', readOnly: false }
    )
    expect(res.rows.length).toBe(10)
    expect(res.truncated).toBe(true)
  })

  it('enforces read-only at the SERVER (blocks a write even past the upstream guard)', async () => {
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'CREATE TABLE t_ro (id int)' },
      { maxRows: 1000, queryId: 'q3', readOnly: false }
    )
    await expect(
      driver.runQuery(
        id,
        { kind: 'sql', sql: 'INSERT INTO t_ro VALUES (1)' },
        { maxRows: 1000, queryId: 'q4', readOnly: true }
      )
    ).rejects.toThrow(/read-only transaction/i)
  })
})
```

- [ ] **Step 6: Run the integration test (Docker must be running).** Run: `npm run test:integration`
Expected: PASS (3 tests). First run pulls `postgres:16-alpine` (slow). If Docker is not running, the suite errors at container start — report it; do NOT mock around it. Also confirm the unit suite is unaffected: `npm test` (still green, integration excluded).

- [ ] **Step 7: Commit.**
```bash
git add -A
git commit -m "test: add testcontainers Postgres integration suite + separate test:integration config"
```

---

## Task 4: Query IPC pipeline (config + secret + guard + driver + history)

Ties Plan 2 and Plan 3 together. A `query-service.ts` orchestrates a run and is unit-tested with a **fake driver** (no DB); the IPC handlers wire it to the real `DriverManager`.

**Files:** Create `src/main/query-service.ts`, `src/main/query-service.test.ts`; modify `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`.

- [ ] **Step 1: Write the failing test** `src/main/query-service.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './persistence/db'
import { createConnection } from './persistence/connections'
import { makeSecretStore, type Encryptor } from './persistence/secrets'
import { listHistory } from './persistence/history'
import { runUserQuery } from './query-service'
import type { DatabaseDriver, QueryResult } from './drivers/types'
import type { ConnectionInput } from '../shared/domain'

const enc: Encryptor = { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() }
const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 5432,
  username: 'u', database: 'd', ssl: false, readOnly: true
}
const fakeResult: QueryResult = {
  columns: [{ name: 'n', dataType: '23' }], rows: [[1]], rowCount: 1, durationMs: 3, truncated: false, documents: null
}

function fakeDriver(calls: string[]): DatabaseDriver {
  return {
    type: 'postgres',
    testConnection: async () => {},
    connect: async () => { calls.push('connect') },
    disconnect: async () => {},
    runQuery: async (_id, req) => { calls.push('run:' + (req.kind === 'sql' ? req.sql : 'mongo')); return fakeResult },
    cancel: async () => {}
  }
}

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('runUserQuery', () => {
  it('runs a read on a read-only connection, returns the result, and logs history', async () => {
    const calls: string[] = []
    const c = createConnection(db, input, 1)
    const secrets = makeSecretStore(db, enc)
    secrets.setPassword(c.id, 'pw')
    const res = await runUserQuery({
      db, secrets, driver: fakeDriver(calls), connectionId: c.id, sql: 'SELECT 1', now: () => 42
    })
    expect(res).toEqual(fakeResult)
    expect(calls).toEqual(['connect', 'run:SELECT 1'])
    const hist = listHistory(db, c.id)
    expect(hist).toHaveLength(1)
    expect(hist[0].query).toBe('SELECT 1')
    expect(hist[0].success).toBe(true)
  })

  it('blocks a write on a read-only connection BEFORE the driver runs, and logs the failure', async () => {
    const calls: string[] = []
    const c = createConnection(db, input, 1)
    await expect(
      runUserQuery({ db, secrets: makeSecretStore(db, enc), driver: fakeDriver(calls), connectionId: c.id, sql: 'DELETE FROM t', now: () => 42 })
    ).rejects.toThrow(/read-only/i)
    expect(calls).toEqual(['connect']) // driver.runQuery NOT called
    expect(listHistory(db, c.id)[0].success).toBe(false)
  })

  it('throws if the connection id is unknown', async () => {
    await expect(
      runUserQuery({ db, secrets: makeSecretStore(db, enc), driver: fakeDriver([]), connectionId: 'nope', sql: 'SELECT 1', now: () => 1 })
    ).rejects.toThrow(/not found/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** `npx vitest run src/main/query-service.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/query-service.ts`:**
```ts
import type { DB } from './persistence/db'
import { getConnection } from './persistence/connections'
import { addHistory } from './persistence/history'
import type { makeSecretStore } from './persistence/secrets'
import type { DatabaseDriver, QueryResult } from './drivers/types'
import { assertSqlWritable } from './drivers/sql/readonly-guard'

const DEFAULT_MAX_ROWS = 1000

interface RunArgs {
  db: DB
  secrets: ReturnType<typeof makeSecretStore>
  driver: DatabaseDriver
  connectionId: string
  sql: string
  /** Injected clock for deterministic history timestamps. */
  now: () => number
}

/** Orchestrate a SQL run: load config+secret, guard, connect, run, log history. */
export async function runUserQuery(args: RunArgs): Promise<QueryResult> {
  const { db, secrets, driver, connectionId, sql, now } = args
  const config = getConnection(db, connectionId)
  if (!config) throw new Error(`Connection not found: ${connectionId}`)

  await driver.connect({
    id: config.id, type: config.type, host: config.host, port: config.port,
    username: config.username, password: secrets.getPassword(config.id),
    database: config.database, ssl: config.ssl
  })

  const started = now()
  try {
    assertSqlWritable(sql, config.readOnly) // upstream guard — throws before the driver runs
    const result = await driver.runQuery(
      config.id,
      { kind: 'sql', sql },
      { maxRows: DEFAULT_MAX_ROWS, queryId: `${config.id}:${started}`, readOnly: config.readOnly }
    )
    addHistory(db, { connectionId: config.id, query: sql, ranAt: started, durationMs: result.durationMs, success: true })
    return result
  } catch (e) {
    addHistory(db, { connectionId: config.id, query: sql, ranAt: started, durationMs: null, success: false })
    throw e
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.** `npx vitest run src/main/query-service.test.ts` → PASS (3 tests).

- [ ] **Step 5: Extend the IPC contract.** In `src/shared/ipc.ts`, add to `IpcChannels` (import `QueryResult` from `'../main/drivers/types'` is WRONG — renderer can't import main; instead move the shared result types... see note). To keep the renderer/main boundary, add a shared result type:

  **5a.** Create `src/shared/query.ts`:
```ts
export interface ColumnMeta {
  name: string
  dataType: string | null
}
export interface QueryResult {
  columns: ColumnMeta[]
  rows: unknown[][]
  rowCount: number
  durationMs: number
  truncated: boolean
  documents: Record<string, unknown>[] | null
}
```
  **5b.** Change `src/main/drivers/types.ts` to re-export these from shared (so there is ONE definition): replace its local `ColumnMeta`/`QueryResult` with `export type { ColumnMeta, QueryResult } from '../../shared/query'`.
  **5c.** Add channels to `IpcChannels` (in `src/shared/ipc.ts`):
```ts
import type { QueryResult } from './query'
// ...inside IpcChannels:
  'query.run': { req: { connectionId: string; sql: string }; res: QueryResult }
  'query.cancel': { req: { connectionId: string; queryId: string }; res: null }
  'connections.test': { req: { input: import('./domain').ConnectionInput; password: string | null }; res: null }
  'connections.disconnect': { req: string; res: null }
```

- [ ] **Step 6: Extend `DbClientApi`** (`src/shared/api.ts`) with a `query` group + `connections.test`/`connections.disconnect`:
```ts
  // add to the connections group:
    test(input: import('./domain').ConnectionInput, password: string | null): Promise<IpcResult<'connections.test'>>
    disconnect(id: string): Promise<IpcResult<'connections.disconnect'>>
  // add a new top-level group:
  query: {
    run(connectionId: string, sql: string): Promise<IpcResult<'query.run'>>
    cancel(connectionId: string, queryId: string): Promise<IpcResult<'query.cancel'>>
  }
```

- [ ] **Step 7: Implement the methods in `src/preload/index.ts`** (add to the `api` object):
```ts
  // inside connections: { ... }
    test: (input, password) => invoke('connections.test', { input, password }),
    disconnect: (id) => invoke('connections.disconnect', id),
  // new group:
  query: {
    run: (connectionId, sql) => invoke('query.run', { connectionId, sql }),
    cancel: (connectionId, queryId) => invoke('query.cancel', { connectionId, queryId })
  }
```

- [ ] **Step 8: Wire the handlers in `src/main/ipc.ts`.** Add a module-level `DriverManager` with `PostgresDriver` registered, and the handlers:
```ts
import { DriverManager } from './drivers/registry'
import { PostgresDriver } from './drivers/sql/postgres'
import { runUserQuery } from './query-service'

const drivers = new DriverManager()
drivers.register(new PostgresDriver())

// inside registerIpcHandlers():
  handle('connections.test', async ({ input, password }) => {
    const driver = drivers.get(input.type)
    await driver.testConnection({
      id: 'test', type: input.type, host: input.host, port: input.port,
      username: input.username, password, database: input.database, ssl: input.ssl
    })
    return ok(null)
  })
  handle('connections.disconnect', async (id) => {
    const { db } = store()
    const c = (await import('./persistence/connections')).getConnection(db, id)
    if (c && drivers.has(c.type)) await drivers.get(c.type).disconnect(id)
    return ok(null)
  })
  handle('query.run', async ({ connectionId, sql }) => {
    const { db, secrets } = store()
    const c = (await import('./persistence/connections')).getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const result = await runUserQuery({ db, secrets, driver: drivers.get(c.type), connectionId, sql, now: () => Date.now() })
    return ok(result)
  })
  handle('query.cancel', async ({ connectionId, queryId }) => {
    const { db } = store()
    const c = (await import('./persistence/connections')).getConnection(db, connectionId)
    if (c && drivers.has(c.type)) await drivers.get(c.type).cancel(connectionId, queryId)
    return ok(null)
  })
```

- [ ] **Step 9: Full gate + commit.**
```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add query IPC pipeline (config+secret+guard+driver+history) with Postgres wired"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (this slice):** concrete driver (Postgres) ✓ T2 + T3; driver registry ✓ T1; normalized results ✓ (shared `QueryResult`); read-only guard enforced at BOTH the app layer (`assertSqlWritable`) and the server (RO transaction) ✓ T2/T4; query reachable from the renderer over typed IPC ✓ T4; history logging on run ✓ T4. MySQL/MariaDB → Plan 3c; MongoDB + mongosh → Plan 3d; schema browsing (listObjects/describeObject) and the real UI → later.
- **Boundary:** the shared `QueryResult` lives in `src/shared/query.ts` (renderer-safe); `src/main/drivers/types.ts` re-exports it, so there is one definition and the renderer never imports main.
- **Native modules:** `pg`/`testcontainers` are pure-JS — no ABI issue (unlike better-sqlite3). The better-sqlite3 Electron-ABI blocker still stands for *running* persistence/queries live in Electron (Plan 4 prerequisite); 3b is verified by unit + Docker integration tests under Node.
- **Type consistency:** `DatabaseDriver`/`RunOptions`/`QueryRequest` reused from 3a; `runUserQuery` returns the shared `QueryResult`; channels in `IpcChannels` ↔ handlers ↔ `DbClientApi` line up.

## Definition of Done

`npm run typecheck`, `npm run lint`, `npm test` (unit) all green, and `npm run test:integration` passes against a real Dockerized Postgres (SELECT normalized correctly, row cap works, server-side read-only blocks a write). The query IPC pipeline compiles end-to-end and is unit-tested with a fake driver (guard runs before the driver; history logged on success and failure). On green → **Plan 3c — MySQL/MariaDB driver** (plugs into the same registry + IPC pipeline).
