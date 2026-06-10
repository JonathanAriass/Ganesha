# MongoDB Driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app connect to and query MongoDB, completing the four-database set. This adds the `MongoDriver` (dispatches a `MongoCommand`, normalizes BSON documents into the shared `QueryResult` shape — both a flat table view and the raw `documents` tree), the command-level read-only guard (including the `aggregate` `$out`/`$merge` write detection flagged back in 3a), and generalizes the query IPC pipeline so it routes SQL text to SQL drivers and Mongo query text (raw-JSON) to the Mongo driver.

**Architecture:** Three pure-logic/wiring pieces (unit-tested, no DB) plus the driver (integration-tested):
1. `mongo/command.ts` gains `isMongoCommandWrite`/`assertMongoCommandWritable` (op allow-list + `aggregate` pipeline scan for `$out`/`$merge`).
2. `mongo/normalize.ts` converts BSON results to the IPC-safe `QueryResult` via `bson`'s EJSON (flat columns by key-union + raw `documents`).
3. The query pipeline generalizes: `query.run` carries `{ connectionId, query }` (was `sql`); `query-service` dispatches by `connection.type` — SQL types run `assertSqlWritable` + `{kind:'sql'}`; `mongodb` runs `parseMongoJson` + `assertMongoCommandWritable` + `{kind:'mongo'}`.
4. `MongoDriver` (`mongodb` client) implements the contract; integration-tested against a real Dockerized Mongo.

**Tech Stack:** `mongodb` + `bson` (pure-JS), `testcontainers` (GenericContainer with a standalone `mongo:7`), Vitest.

**This is Plan 3d** (3a/3b/3c ✓ → **3d Mongo** → 3e mongosh shell parser). Builds on `main` after Plan 3c. Docker required for the integration suite. Mongo read-only is enforced by the op/pipeline guard (Mongo has no SQL-style read-only transaction).

---

## File Structure

```
src/main/drivers/mongo/command.ts         MODIFY — add isMongoCommandWrite / assertMongoCommandWritable
src/main/drivers/mongo/command.test.ts     MODIFY — add tests for the write guard
src/main/drivers/mongo/normalize.ts        CREATE — BSON → QueryResult (EJSON)
src/main/drivers/mongo/normalize.test.ts   CREATE
src/main/drivers/mongo/mongo.ts            CREATE — MongoDriver
src/main/drivers/mongo/mongo.integration.test.ts  CREATE — testcontainers (Docker)
src/main/query-service.ts                  MODIFY — dispatch SQL vs Mongo (sql -> query)
src/main/query-service.test.ts             MODIFY — query rename + Mongo dispatch test
src/shared/ipc.ts                          MODIFY — query.run req: sql -> query
src/shared/api.ts                          MODIFY — query.run(connectionId, query)
src/preload/index.ts                       MODIFY — query.run(connectionId, query)
src/main/ipc.ts                            MODIFY — query.run handler arg; register MongoDriver
package.json                               MODIFY — add mongodb + bson
```

---

## Task 1: Mongo command-level read-only guard (aggregate `$out`/`$merge`)

The op allow-list (3a) blocks write *ops*, but `aggregate` is a read op that can write via `$out`/`$merge`. Close that at the command level.

**Files:** Modify `src/main/drivers/mongo/command.ts`, `command.test.ts`.

- [ ] **Step 1: Add the failing test** to `src/main/drivers/mongo/command.test.ts` (append a new describe block):
```ts
import { isMongoCommandWrite, assertMongoCommandWritable } from './command'
import type { MongoCommand } from './command'

describe('mongo command-level write detection', () => {
  const find: MongoCommand = { op: 'find', collection: 'c' }
  const del: MongoCommand = { op: 'deleteOne', collection: 'c', filter: {} }
  const aggRead: MongoCommand = { op: 'aggregate', collection: 'c', pipeline: [{ $match: { x: 1 } }] }
  const aggOut: MongoCommand = { op: 'aggregate', collection: 'c', pipeline: [{ $match: { x: 1 } }, { $out: 'dest' }] }
  const aggMerge: MongoCommand = { op: 'aggregate', collection: 'c', pipeline: [{ $merge: { into: 'dest' } }] }

  it('classifies reads vs writes incl. aggregate $out/$merge', () => {
    expect(isMongoCommandWrite(find)).toBe(false)
    expect(isMongoCommandWrite(del)).toBe(true)
    expect(isMongoCommandWrite(aggRead)).toBe(false)
    expect(isMongoCommandWrite(aggOut)).toBe(true)
    expect(isMongoCommandWrite(aggMerge)).toBe(true)
  })

  it('assertMongoCommandWritable blocks writes (incl. $out/$merge aggregate) only when read-only', () => {
    expect(() => assertMongoCommandWritable(aggRead, true)).not.toThrow()
    expect(() => assertMongoCommandWritable(aggOut, false)).not.toThrow()
    expect(() => assertMongoCommandWritable(aggOut, true)).toThrow(/read-only/i)
    expect(() => assertMongoCommandWritable(del, true)).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/main/drivers/mongo/command.test.ts`

- [ ] **Step 3: Append to `src/main/drivers/mongo/command.ts`:**
```ts
function pipelineHasWriteStage(pipeline: Record<string, unknown>[] | undefined): boolean {
  return !!pipeline?.some((stage) => '$out' in stage || '$merge' in stage)
}

/** True if the command writes — a write op, or an aggregate with a $out/$merge stage. */
export function isMongoCommandWrite(cmd: MongoCommand): boolean {
  if (!isMongoReadOp(cmd.op)) return true
  return cmd.op === 'aggregate' && pipelineHasWriteStage(cmd.pipeline)
}

/** Throw if the command writes on a read-only connection (covers aggregate $out/$merge). */
export function assertMongoCommandWritable(cmd: MongoCommand, readOnly: boolean): void {
  if (readOnly && isMongoCommandWrite(cmd)) {
    const detail = cmd.op === 'aggregate' ? `'aggregate' with $out/$merge` : `'${cmd.op}'`
    throw new Error(`This connection is read-only — ${detail} is a write operation and is blocked.`)
  }
}
```

- [ ] **Step 4: Run → PASS** + `npm run typecheck`. **Step 5: Commit:** `git add -A && git commit -m "feat: add Mongo command-level write guard (aggregate \$out/\$merge detection)"`

---

## Task 2: Mongo result normalization (BSON → QueryResult)

**Files:** Modify `package.json`; create `src/main/drivers/mongo/normalize.ts`, `normalize.test.ts`.

- [ ] **Step 1: Add deps.** `npm install mongodb@^6.9.0 bson@^6.8.0`

- [ ] **Step 2: Write the failing test** `src/main/drivers/mongo/normalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { normalizeFind, normalizeScalar, normalizeValues, normalizeWriteResult } from './normalize'

describe('mongo normalize', () => {
  it('normalizeFind builds a key-union table + EJSON documents, caps rows', () => {
    const oid = new ObjectId('507f1f77bcf86cd799439011')
    const docs = [{ _id: oid, name: 'a', age: 30 }, { _id: oid, name: 'b' }]
    const res = normalizeFind(docs, 10, 5)
    expect(res.columns.map((c) => c.name)).toEqual(['_id', 'name', 'age'])
    expect(res.rows[0][1]).toBe('a')
    expect(res.rows[1][2]).toBeNull() // missing age -> null
    expect((res.rows[0][0] as { $oid: string }).$oid).toBe('507f1f77bcf86cd799439011') // EJSON ObjectId
    expect(res.rowCount).toBe(2)
    expect(res.truncated).toBe(false)
    expect(res.documents).toHaveLength(2)
    expect(res.durationMs).toBe(5)
  })

  it('normalizeFind truncates beyond maxRows', () => {
    const res = normalizeFind([{ a: 1 }, { a: 2 }, { a: 3 }], 2, 0)
    expect(res.rows).toHaveLength(2)
    expect(res.truncated).toBe(true)
    expect(res.rowCount).toBe(3)
  })

  it('normalizeScalar wraps a count', () => {
    const res = normalizeScalar('count', 42, 1)
    expect(res.columns.map((c) => c.name)).toEqual(['count'])
    expect(res.rows).toEqual([[42]])
    expect(res.documents).toBeNull()
  })

  it('normalizeValues wraps distinct values', () => {
    const res = normalizeValues('value', ['us', 'uk'], 10, 1)
    expect(res.rows).toEqual([['us'], ['uk']])
  })

  it('normalizeWriteResult flattens an insert/update result', () => {
    const res = normalizeWriteResult({ acknowledged: true, insertedCount: 2 }, 1)
    expect(res.columns.map((c) => c.name)).toEqual(['acknowledged', 'insertedCount'])
    expect(res.rows).toEqual([[true, 2]])
    expect(res.documents).toBeNull()
  })
})
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/main/drivers/mongo/normalize.test.ts`

- [ ] **Step 4: Create `src/main/drivers/mongo/normalize.ts`:**
```ts
import { EJSON } from 'bson'
import type { QueryResult, ColumnMeta } from '../../../shared/query'

/** Serialize a BSON document/value to plain, IPC-safe EJSON (ObjectId -> {$oid}, Date -> {$date}, ...). */
function toPlain<T = Record<string, unknown>>(value: unknown): T {
  return EJSON.serialize(value as object) as T
}

/** find / findOne / aggregate → flat key-union table + raw EJSON documents. */
export function normalizeFind(docs: unknown[], maxRows: number, durationMs: number): QueryResult {
  const plain = docs.map((d) => toPlain(d))
  const truncated = plain.length > maxRows
  const capped = truncated ? plain.slice(0, maxRows) : plain

  const keys: string[] = []
  const seen = new Set<string>()
  for (const d of capped) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  const columns: ColumnMeta[] = keys.map((name) => ({ name, dataType: null }))
  const rows = capped.map((d) => keys.map((k) => (k in d ? d[k] : null)))
  return { columns, rows, rowCount: plain.length, durationMs, truncated, documents: capped }
}

/** count / countDocuments → single scalar cell. */
export function normalizeScalar(name: string, value: unknown, durationMs: number): QueryResult {
  const cell = (toPlain<{ v: unknown }>({ v: value })).v
  return { columns: [{ name, dataType: null }], rows: [[cell]], rowCount: 1, durationMs, truncated: false, documents: null }
}

/** distinct → one column of values. */
export function normalizeValues(name: string, values: unknown[], maxRows: number, durationMs: number): QueryResult {
  const plain = toPlain<unknown[]>(values)
  const truncated = plain.length > maxRows
  const capped = truncated ? plain.slice(0, maxRows) : plain
  return { columns: [{ name, dataType: null }], rows: capped.map((v) => [v]), rowCount: plain.length, durationMs, truncated, documents: null }
}

/** insert/update/delete/replace → flatten the driver's result object into one row. */
export function normalizeWriteResult(result: unknown, durationMs: number): QueryResult {
  const plain = toPlain(result)
  const keys = Object.keys(plain)
  return {
    columns: keys.map((name) => ({ name, dataType: null })),
    rows: [keys.map((k) => plain[k])],
    rowCount: 1,
    durationMs,
    truncated: false,
    documents: null
  }
}
```

- [ ] **Step 5: Run → PASS** + `npm run typecheck && npm run lint`. **Step 6: Commit:** `git add -A && git commit -m "feat: add Mongo result normalization (BSON->QueryResult via EJSON)"`

---

## Task 3: Generalize the query pipeline (SQL text → SQL drivers, Mongo text → Mongo)

`query.run` currently carries `sql`. Rename to `query` and dispatch by connection type. (No UI consumes this yet, so the rename is safe.)

**Files:** Modify `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/query-service.ts`, `src/main/query-service.test.ts`.

- [ ] **Step 1: Rename the channel req** in `src/shared/ipc.ts`: change `'query.run': { req: { connectionId: string; sql: string }; res: QueryResult }` to `'query.run': { req: { connectionId: string; query: string }; res: QueryResult }`.

- [ ] **Step 2: Update `src/shared/api.ts`:** `run(connectionId: string, query: string): Promise<IpcResult<'query.run'>>`.

- [ ] **Step 3: Update `src/preload/index.ts`:** `run: (connectionId, query) => invoke('query.run', { connectionId, query })`.

- [ ] **Step 4: Update `src/main/query-service.ts`** — rename `sql` → `query` and dispatch by type. Replace the body of `runUserQuery` (keep the load-config + connect + history structure) so the request is built per connection type:
```ts
import type { DB } from './persistence/db'
import { getConnection } from './persistence/connections'
import { addHistory } from './persistence/history'
import type { makeSecretStore } from './persistence/secrets'
import type { DatabaseDriver, QueryResult, QueryRequest } from './drivers/types'
import { assertSqlWritable } from './drivers/sql/readonly-guard'
import { parseMongoJson } from './drivers/mongo/raw'
import { assertMongoCommandWritable } from './drivers/mongo/command'

const DEFAULT_MAX_ROWS = 1000

interface RunArgs {
  db: DB
  secrets: ReturnType<typeof makeSecretStore>
  driver: DatabaseDriver
  connectionId: string
  query: string
  now: () => number
}

export async function runUserQuery(args: RunArgs): Promise<QueryResult> {
  const { db, secrets, driver, connectionId, query, now } = args
  const config = getConnection(db, connectionId)
  if (!config) throw new Error(`Connection not found: ${connectionId}`)

  await driver.connect({
    id: config.id, type: config.type, host: config.host, port: config.port,
    username: config.username, password: secrets.getPassword(config.id),
    database: config.database, ssl: config.ssl
  })

  const started = now()
  try {
    let request: QueryRequest
    if (config.type === 'mongodb') {
      const command = parseMongoJson(query)
      assertMongoCommandWritable(command, config.readOnly)
      request = { kind: 'mongo', command }
    } else {
      assertSqlWritable(query, config.readOnly)
      request = { kind: 'sql', sql: query }
    }
    const result = await driver.runQuery(config.id, request, {
      maxRows: DEFAULT_MAX_ROWS, queryId: `${config.id}:${started}`, readOnly: config.readOnly
    })
    addHistory(db, { connectionId: config.id, query, ranAt: started, durationMs: result.durationMs, success: true })
    return result
  } catch (e) {
    addHistory(db, { connectionId: config.id, query, ranAt: started, durationMs: null, success: false })
    throw e
  }
}
```

- [ ] **Step 5: Update `src/main/query-service.test.ts`** — rename `sql:` → `query:` in the three existing `runUserQuery({...})` calls (the SQL cases still use `type: 'postgres'`). Then ADD a Mongo dispatch test:
```ts
it('dispatches a mongo connection through the raw-JSON parser + command guard', async () => {
  const calls: string[] = []
  const mongoInput = { ...input, type: 'mongodb' as const, readOnly: true }
  const c = createConnection(db, mongoInput, 1)
  // a read (find) is allowed on a read-only mongo connection
  const res = await runUserQuery({
    db, secrets: makeSecretStore(db, enc), driver: fakeDriver(calls), connectionId: c.id,
    query: JSON.stringify({ op: 'find', collection: 'users', filter: { age: { $gt: 21 } } }), now: () => 7
  })
  expect(res).toEqual(fakeResult)
  expect(calls).toEqual(['connect', 'run:mongo'])
  // a write op is blocked on a read-only mongo connection
  await expect(runUserQuery({
    db, secrets: makeSecretStore(db, enc), driver: fakeDriver([]), connectionId: c.id,
    query: JSON.stringify({ op: 'deleteOne', collection: 'users', filter: {} }), now: () => 7
  })).rejects.toThrow(/read-only/i)
})
```
(The existing `fakeDriver` already pushes `'run:mongo'` for a mongo request — see its `req.kind === 'sql' ? req.sql : 'mongo'`.)

- [ ] **Step 6: Update the `query.run` handler in `src/main/ipc.ts`** — change the destructured arg and the `runUserQuery` call from `sql` to `query`:
```ts
  handle('query.run', async ({ connectionId, query }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const result = await runUserQuery({ db, secrets, driver: drivers.get(c.type), connectionId, query, now: () => Date.now() })
    return ok(result)
  })
```

- [ ] **Step 7: Full gate.** `npm run typecheck && npm run lint && npm test` — all green (query-service tests incl. the new Mongo dispatch). **Step 8: Commit:** `git add -A && git commit -m "feat: generalize query pipeline to dispatch SQL vs Mongo by connection type"`

---

## Task 4: MongoDriver + integration test

**Files:** Modify `src/main/ipc.ts` (register); create `src/main/drivers/mongo/mongo.ts`, `mongo.integration.test.ts`. **Integration requires Docker** (controller runs it).

- [ ] **Step 1: Create `src/main/drivers/mongo/mongo.ts`:**
```ts
import { MongoClient } from 'mongodb'
import type { DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult } from '../types'
import { normalizeFind, normalizeScalar, normalizeValues, normalizeWriteResult } from './normalize'

/** MongoDB driver. Read-only is enforced upstream by the command guard (no SQL-style RO txn). */
export class MongoDriver implements DatabaseDriver {
  readonly type = 'mongodb' as const
  private clients = new Map<string, MongoClient>()

  private uri(p: ConnectParams): string {
    const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : ''
    const db = p.database ? `/${encodeURIComponent(p.database)}` : ''
    const tls = p.ssl ? '?tls=true' : ''
    return `mongodb://${auth}${p.host}:${p.port}${db}${tls}`
  }

  private newClient(p: ConnectParams): MongoClient {
    return new MongoClient(this.uri(p), { serverSelectionTimeoutMS: 10_000 })
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const client = this.newClient(p)
    try {
      await client.connect()
      await client.db().command({ ping: 1 })
    } finally {
      await client.close()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    if (this.clients.has(p.id)) return
    const client = this.newClient(p)
    await client.connect()
    this.clients.set(p.id, client)
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (client) {
      this.clients.delete(id)
      await client.close()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'mongo') throw new Error('MongoDriver handles only Mongo requests')
    const client = this.clients.get(id)
    if (!client) throw new Error(`Connection '${id}' is not open`)
    const cmd = request.command
    const coll = client.db().collection(cmd.collection)
    const start = Date.now()
    const ms = (): number => Date.now() - start

    switch (cmd.op) {
      case 'find': {
        const cursor = coll.find(cmd.filter ?? {}, {
          projection: cmd.projection,
          sort: cmd.sort as Record<string, 1 | -1> | undefined,
          skip: cmd.skip,
          limit: cmd.limit ?? opts.maxRows + 1,
          maxTimeMS: 30_000
        })
        return normalizeFind(await cursor.toArray(), opts.maxRows, ms())
      }
      case 'findOne': {
        const doc = await coll.findOne(cmd.filter ?? {}, { projection: cmd.projection })
        return normalizeFind(doc ? [doc] : [], opts.maxRows, ms())
      }
      case 'aggregate':
        return normalizeFind(await coll.aggregate(cmd.pipeline ?? [], { maxTimeMS: 30_000 }).toArray(), opts.maxRows, ms())
      case 'count':
      case 'countDocuments':
        return normalizeScalar('count', await coll.countDocuments(cmd.filter ?? {}), ms())
      case 'distinct':
        return normalizeValues('value', await coll.distinct(cmd.field ?? '_id', cmd.filter ?? {}), opts.maxRows, ms())
      case 'insertOne':
        return normalizeWriteResult(await coll.insertOne(cmd.document ?? {}), ms())
      case 'insertMany':
        return normalizeWriteResult(await coll.insertMany(cmd.documents ?? []), ms())
      case 'updateOne':
        return normalizeWriteResult(await coll.updateOne(cmd.filter ?? {}, cmd.update ?? {}), ms())
      case 'updateMany':
        return normalizeWriteResult(await coll.updateMany(cmd.filter ?? {}, cmd.update ?? {}), ms())
      case 'replaceOne':
        return normalizeWriteResult(await coll.replaceOne(cmd.filter ?? {}, cmd.replacement ?? {}), ms())
      case 'deleteOne':
        return normalizeWriteResult(await coll.deleteOne(cmd.filter ?? {}), ms())
      case 'deleteMany':
        return normalizeWriteResult(await coll.deleteMany(cmd.filter ?? {}), ms())
    }
  }

  async cancel(): Promise<void> {
    // v1: MongoDB has no simple per-query cancel; ops carry maxTimeMS. killOp is a future enhancement.
  }
}
```
> If mongodb's strict types reject a specific cast (filter/sort/update), adjust the CAST only — keep the logic. Do NOT use `as any` (lint forbids it); prefer a precise cast.

- [ ] **Step 2: Register in `src/main/ipc.ts`** next to the other drivers:
```ts
import { MongoDriver } from './drivers/mongo/mongo'
// ...
drivers.register(new MongoDriver())
```

- [ ] **Step 3: Create `src/main/drivers/mongo/mongo.integration.test.ts`** (standalone mongo via GenericContainer — no replica set, so a direct `mongodb://host:port` connects cleanly):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { MongoDriver } from './mongo'

describe('MongoDriver (integration, requires Docker)', () => {
  let container: StartedTestContainer
  const driver = new MongoDriver()
  const id = 'itest'

  beforeAll(async () => {
    container = await new GenericContainer('mongo:7').withExposedPorts(27017).start()
    await driver.connect({
      id, type: 'mongodb', host: container.getHost(), port: container.getMappedPort(27017),
      username: '', password: null, database: 'testdb', ssl: false
    })
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertMany', collection: 'users', documents: [{ name: 'a', age: 30 }, { name: 'b' }] } }, { maxRows: 1000, queryId: 's', readOnly: false })
  })

  afterAll(async () => {
    await driver.disconnect(id)
    await container?.stop()
  })

  it('find returns a key-union table + raw documents', async () => {
    const res = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'users', sort: { name: 1 } } }, { maxRows: 1000, queryId: 'q1', readOnly: false })
    expect(res.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['_id', 'name', 'age']))
    expect(res.documents).toHaveLength(2)
    expect(res.rowCount).toBe(2)
  })

  it('countDocuments and aggregate work', async () => {
    const c = await driver.runQuery(id, { kind: 'mongo', command: { op: 'countDocuments', collection: 'users' } }, { maxRows: 1000, queryId: 'q2', readOnly: false })
    expect(c.rows).toEqual([[2]])
    const agg = await driver.runQuery(id, { kind: 'mongo', command: { op: 'aggregate', collection: 'users', pipeline: [{ $match: { name: 'a' } }] } }, { maxRows: 1000, queryId: 'q3', readOnly: false })
    expect(agg.documents).toHaveLength(1)
  })

  it('find caps rows and flags truncated', async () => {
    const res = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'users' } }, { maxRows: 1, queryId: 'q4', readOnly: false })
    expect(res.rows).toHaveLength(1)
    expect(res.truncated).toBe(true)
  })
})
```

- [ ] **Step 4: Unit gate.** `npm run typecheck && npm run lint && npm test` (integration excluded). **Controller** then runs `npm run test:integration` (pg + mysql + mongo). **Step 5: Commit:** `git add -A && git commit -m "feat: add MongoDriver (mongodb) with command dispatch + EJSON normalization"`

---

## Self-Review (completed by plan author)

- **Spec coverage:** MongoDB driver implementing `DatabaseDriver` ✓ T4; command dispatch for all v1 ops ✓ T4; BSON→`QueryResult` normalization (flat table + raw `documents`) ✓ T2; `aggregate` `$out`/`$merge` write detection ✓ T1 (the 3a carry-forward); query pipeline now routes Mongo text via `parseMongoJson` + the command guard ✓ T3; integration-tested ✓ T4. The mongosh shell parser is Plan 3e (raw-JSON is the Mongo input until then).
- **Read-only:** Mongo has no SQL-style RO transaction; enforcement is the op + pipeline guard (`assertMongoCommandWritable`), applied in the pipeline before the driver runs. Documented.
- **Cancellation:** Mongo `cancel` is a documented v1 no-op (ops carry `maxTimeMS`); killOp is future work.
- **Native modules:** `mongodb`/`bson` are pure-JS — no ABI issue. The better-sqlite3 Electron-ABI blocker for *live* in-app queries still stands until Plan 4.
- **Type consistency:** `QueryResult`/`ColumnMeta` from `src/shared/query.ts`; `MongoCommand` from `mongo/command.ts`; `QueryRequest` from `drivers/types.ts`; the `query.run` rename is applied across ipc/api/preload/service consistently.

## Definition of Done

`npm run typecheck`, `npm run lint`, `npm test` (unit) green (command write-guard, normalize, and Mongo-dispatch tests included), and `npm run test:integration` passes for Postgres + MySQL + Mongo. A MongoDB connection runs raw-JSON queries through the pipeline and returns normalized results with a populated `documents` tree; aggregate `$out`/`$merge` is blocked on a read-only connection. **All four databases now work at the driver level.** On green → **Plan 3e — mongosh shell parser** (then Plan 4 — UI + the better-sqlite3 ABI fix).
