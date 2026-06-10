# MySQL / MariaDB Driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MySQL/MariaDB driver that plugs into the existing `DriverManager` + query IPC pipeline, so the app can connect to and query MySQL and MariaDB exactly the way it already does Postgres — with the same normalized results, row cap, server-side read-only enforcement, and cancellation.

**Architecture:** `src/main/drivers/sql/mysql.ts` adds `MySqlDriver implements DatabaseDriver` using the pure-JS `mysql2/promise` pool. Because MySQL and MariaDB share the wire protocol, one class serves both — its `type` is a constructor parameter (`'mysql' | 'mariadb'`), and `src/main/ipc.ts` registers **two instances** (one per type) since the registry keys on `driver.type`. No new IPC channels, no `query-service` change — the pipeline is already driver-agnostic. Integration-tested against a real Dockerized MySQL.

**Tech Stack:** `mysql2` (pure-JS, no ABI issue), `@testcontainers/mysql`, Vitest.

**This is Plan 3c** (3a ✓ contract/safety → 3b ✓ Postgres+IPC → **3c MySQL/MariaDB** → 3d Mongo → 3e mongosh). Builds on `main` after Plan 3b. Docker required for the integration suite.

---

## File Structure

```
src/main/drivers/sql/mysql.ts            CREATE — MySqlDriver
src/main/drivers/sql/mysql.test.ts       CREATE — unit test (dual-type constructor)
src/main/drivers/sql/mysql.integration.test.ts  CREATE — testcontainers MySQL
src/main/ipc.ts                          MODIFY — register MySqlDriver for mysql + mariadb
package.json                             MODIFY — add mysql2 + @testcontainers/mysql
```

---

## Task 1: MySqlDriver + registration

**Files:** Modify `package.json`, `src/main/ipc.ts`; create `src/main/drivers/sql/mysql.ts`, `mysql.test.ts`.

- [ ] **Step 1: Add deps.** Run: `npm install mysql2@^3.11.0 && npm install -D @testcontainers/mysql@^10.13.0`

- [ ] **Step 2: Create `src/main/drivers/sql/mysql.ts`:**
```ts
import mysql from 'mysql2/promise'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta
} from '../types'
import type { ConnectionType } from '../../../shared/domain'

/** MySQL/MariaDB driver (shared wire protocol) backed by a per-connection mysql2 pool.
 *  One class serves both — `type` is set per instance so the registry can hold both. */
export class MySqlDriver implements DatabaseDriver {
  readonly type: ConnectionType
  private pools = new Map<string, mysql.Pool>()
  private running = new Map<string, number>() // queryId -> mysql threadId

  constructor(type: 'mysql' | 'mariadb' = 'mysql') {
    this.type = type
  }

  private poolConfig(p: ConnectParams): mysql.PoolOptions {
    return {
      host: p.host,
      port: p.port,
      user: p.username,
      password: p.password ?? undefined,
      database: p.database || undefined,
      ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 4,
      connectTimeout: 10_000
    }
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const pool = mysql.createPool(this.poolConfig(p))
    try {
      await pool.query('SELECT 1')
    } finally {
      await pool.end()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    // Idempotent (mirrors PostgresDriver): existing pool keeps its credentials until disconnect().
    if (!this.pools.has(p.id)) this.pools.set(p.id, mysql.createPool(this.poolConfig(p)))
  }

  async disconnect(id: string): Promise<void> {
    const pool = this.pools.get(id)
    if (pool) {
      this.pools.delete(id)
      await pool.end()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'sql') throw new Error('MySqlDriver handles only SQL requests')
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)

    const conn = await pool.getConnection()
    this.running.set(opts.queryId, conn.threadId)
    const start = Date.now()
    try {
      if (opts.readOnly) await conn.query('START TRANSACTION READ ONLY')
      const [rawRows, rawFields] = (await conn.query({ sql: request.sql, rowsAsArray: true })) as [
        unknown,
        mysql.FieldPacket[] | undefined
      ]
      if (opts.readOnly) await conn.query('COMMIT')

      const fields = rawFields ?? []
      const columns: ColumnMeta[] = fields.map((f) => ({
        name: f.name,
        dataType: f.type != null ? String(f.type) : null
      }))
      const isResultSet = Array.isArray(rawRows)
      const allRows = isResultSet ? (rawRows as unknown[][]) : []
      const truncated = allRows.length > opts.maxRows
      const rows = truncated ? allRows.slice(0, opts.maxRows) : allRows
      return {
        columns,
        rows,
        rowCount: isResultSet ? allRows.length : ((rawRows as { affectedRows?: number }).affectedRows ?? 0),
        durationMs: Date.now() - start,
        truncated,
        documents: null
      }
    } catch (e) {
      if (opts.readOnly) {
        try {
          await conn.query('ROLLBACK')
        } catch {
          /* already aborted */
        }
      }
      throw e
    } finally {
      this.running.delete(opts.queryId)
      conn.release()
    }
  }

  async cancel(id: string, queryId: string): Promise<void> {
    const threadId = this.running.get(queryId)
    const pool = this.pools.get(id)
    if (threadId && pool) await pool.query('KILL QUERY ?', [threadId])
  }
}
```

> Note: mysql2's `query()` is heavily overloaded; the `as [unknown, FieldPacket[] | undefined]` cast keeps the result handling explicit (result set → arrays via `rowsAsArray`; OK packet for writes → `affectedRows`). If typecheck complains about a specific cast, adjust the cast only — do NOT change the logic.

- [ ] **Step 3: Write the unit test** `src/main/drivers/sql/mysql.test.ts` (verifies the dual-type design + request guard without a DB):
```ts
import { describe, it, expect } from 'vitest'
import { MySqlDriver } from './mysql'

describe('MySqlDriver', () => {
  it('defaults to mysql and accepts mariadb as its type', () => {
    expect(new MySqlDriver().type).toBe('mysql')
    expect(new MySqlDriver('mariadb').type).toBe('mariadb')
  })

  it('rejects a non-SQL request', async () => {
    await expect(
      new MySqlDriver().runQuery('x', { kind: 'mongo', command: { op: 'find', collection: 'c' } }, {
        maxRows: 10,
        queryId: 'q',
        readOnly: false
      })
    ).rejects.toThrow(/only sql/i)
  })
})
```

- [ ] **Step 4: Register both types in `src/main/ipc.ts`.** Add the import and the two registrations next to the existing PostgresDriver registration:
```ts
import { MySqlDriver } from './drivers/sql/mysql'
// ...where `drivers.register(new PostgresDriver())` is:
drivers.register(new MySqlDriver('mysql'))
drivers.register(new MySqlDriver('mariadb'))
```

- [ ] **Step 5: Unit gate.** Run: `npm run typecheck && npm run lint && npm test` — all green (mysql unit test included; integration excluded). Do NOT run dev/test:integration.

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "feat: add MySqlDriver (mysql2) and register it for mysql + mariadb"
```

---

## Task 2: MySQL integration test (testcontainers)

**Files:** Create `src/main/drivers/sql/mysql.integration.test.ts`. **Requires Docker.** (The controller runs this suite.)

- [ ] **Step 1: Create `src/main/drivers/sql/mysql.integration.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { MySqlDriver } from './mysql'

describe('MySqlDriver (integration, requires Docker)', () => {
  let container: StartedMySqlContainer
  const driver = new MySqlDriver('mysql')
  const id = 'itest'

  beforeAll(async () => {
    container = await new MySqlContainer('mysql:8').start()
    await driver.connect({
      id,
      type: 'mysql',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getUserPassword(),
      database: container.getDatabase(),
      ssl: false
    })
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
    expect(res.truncated).toBe(false)
    expect(res.documents).toBeNull()
  })

  it('caps rows at maxRows and flags truncated', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE nums (n INT)' }, { maxRows: 1000, queryId: 'q2', readOnly: false })
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'INSERT INTO nums VALUES (1),(2),(3),(4),(5)' },
      { maxRows: 1000, queryId: 'q3', readOnly: false }
    )
    const res = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT n FROM nums ORDER BY n' }, { maxRows: 2, queryId: 'q4', readOnly: false })
    expect(res.rows.length).toBe(2)
    expect(res.truncated).toBe(true)
  })

  it('enforces read-only at the SERVER (blocks a write)', async () => {
    await expect(
      driver.runQuery(id, { kind: 'sql', sql: 'INSERT INTO nums VALUES (99)' }, { maxRows: 1000, queryId: 'q5', readOnly: true })
    ).rejects.toThrow(/read[- ]?only/i)
  })
})
```

- [ ] **Step 2: Run the integration suite (Docker).** Run: `npm run test:integration`
Expected: PASS — both the Postgres suite (from 3b) and this MySQL suite. First MySQL run pulls `mysql:8` (large image, slow startup — the 180s hook timeout covers it). If Docker isn't running, report it; do NOT mock around it. Confirm `npm test` (unit) still green.

- [ ] **Step 3: Commit.**
```bash
git add -A
git commit -m "test: add testcontainers MySQL integration suite for MySqlDriver"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** MySQL + MariaDB driver implementing `DatabaseDriver` ✓ T1; same normalized results / row cap / server-side read-only (`START TRANSACTION READ ONLY`) / cancellation (`KILL QUERY`) as Postgres ✓; registered for both types ✓ T1 Step 4; integration-tested ✓ T2. No IPC changes needed (pipeline is driver-agnostic).
- **Dual-type design:** one `MySqlDriver` class, `type` per instance, two registrations — satisfies the registry's one-driver-per-type keying (flagged in the 3b review).
- **Native modules:** `mysql2` is pure-JS — no ABI issue; works under Node tests and (eventually) Electron. The better-sqlite3 Electron-ABI blocker for *live* queries in the running app still stands until Plan 4.
- **Consistency:** mirrors `PostgresDriver` exactly (pool map, `running` map for cancel, RO transaction wrap, finally-release). `ConnectionType` already includes `mysql`/`mariadb`; the read-only guard already blocks MySQL `INTO OUTFILE/DUMPFILE`.

## Definition of Done

`npm run typecheck`, `npm run lint`, `npm test` (unit) green with the MySqlDriver unit test, and `npm run test:integration` passes for BOTH Postgres and MySQL (SELECT normalized, row cap, server-side read-only blocks a write). MySQL and MariaDB connections route through the existing query pipeline with no IPC changes. On green → **Plan 3d — MongoDB driver**.
