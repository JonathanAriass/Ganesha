# Driver Contract & Query Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the database-driver contract every concrete driver will implement, plus the two pieces of pure query-safety logic that must be correct before any query ever reaches a real database: the **read-only guard** (blocks writes/DDL on a read-only connection) and the **MongoDB raw-JSON command parser/validator**.

**Architecture:** All of this lives in the **main** process under `src/main/drivers/`. It is pure, synchronous logic with **no database connections and no new dependencies** — every unit is verified by Vitest under Node. The `DatabaseDriver` interface and the normalized `QueryResult` shape are the contracts Plan 3b's concrete drivers (`pg`/`mysql2`/`mongodb`) implement; the read-only guard and Mongo command model are consumed by those drivers and by the IPC layer.

**Tech Stack:** TypeScript only. Vitest. (acorn + bson arrive in Plan 3c for the `mongosh` shell parser; the `pg`/`mysql2`/`mongodb` drivers arrive in Plan 3b.)

**This is Plan 3a of the drivers subsystem** (3a contract+safety → 3b concrete drivers+integration → 3c mongosh parser). Builds on `main` after Plan 2.

---

## File Structure (created by this plan)

```
src/main/drivers/
  types.ts          DatabaseDriver interface, QueryResult/ColumnMeta, ConnectParams, RunOptions, QueryRequest
  mongo/
    command.ts      MongoCommand model, MongoOp union, read-op set, assertMongoWritable
    command.test.ts
    raw.ts          parseMongoJson(input) -> MongoCommand (per-op validation)
    raw.test.ts
  sql/
    readonly-guard.ts       isSqlReadOnly / assertSqlWritable + comment-strip + statement split
    readonly-guard.test.ts
```

No IPC wiring and no concrete drivers here — those are Plan 3b. `QueryRequest` references `MongoCommand` so the contract is complete, but nothing executes it yet.

---

## Task 1: Driver contract types + Mongo command model

**Files:** Create `src/main/drivers/types.ts`, `src/main/drivers/mongo/command.ts`, `src/main/drivers/mongo/command.test.ts`.

- [ ] **Step 1: Create `src/main/drivers/mongo/command.ts`:**

```ts
export type MongoReadOp = 'find' | 'findOne' | 'aggregate' | 'count' | 'countDocuments' | 'distinct'
export type MongoWriteOp =
  | 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'replaceOne'
export type MongoOp = MongoReadOp | MongoWriteOp

/** A normalized MongoDB operation. Both the raw-JSON parser (Plan 3a) and the
 *  mongosh shell parser (Plan 3c) produce this; the Mongo driver (3b) dispatches on it. */
export interface MongoCommand {
  op: MongoOp
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, unknown>
  limit?: number
  skip?: number
  pipeline?: Record<string, unknown>[]
  document?: Record<string, unknown>
  documents?: Record<string, unknown>[]
  update?: Record<string, unknown>
  replacement?: Record<string, unknown>
  field?: string
}

const READ_OPS = new Set<MongoOp>(['find', 'findOne', 'aggregate', 'count', 'countDocuments', 'distinct'])
const ALL_OPS = new Set<MongoOp>([
  ...READ_OPS,
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne'
])

export function isMongoOp(s: string): s is MongoOp {
  return ALL_OPS.has(s as MongoOp)
}

export function isMongoReadOp(op: MongoOp): boolean {
  return READ_OPS.has(op)
}

/** Throw if a write op is issued on a read-only connection. */
export function assertMongoWritable(op: MongoOp, readOnly: boolean): void {
  if (readOnly && !isMongoReadOp(op)) {
    throw new Error(`This connection is read-only — '${op}' is a write operation and is blocked.`)
  }
}
```

- [ ] **Step 2: Create `src/main/drivers/types.ts`:**

```ts
import type { ConnectionType } from '../../shared/domain'
import type { MongoCommand } from './mongo/command'

export interface ColumnMeta {
  name: string
  /** Driver-reported type label if available (e.g. 'int4', 'varchar', 'ObjectId'). */
  dataType: string | null
}

/** Normalized, IPC-serializable result set returned by every driver. */
export interface QueryResult {
  columns: ColumnMeta[]
  /** Row-major: each inner array aligns positionally to `columns`. */
  rows: unknown[][]
  rowCount: number
  durationMs: number
  /** True when the driver capped the row set (see RunOptions.maxRows). */
  truncated: boolean
  /** For document stores (Mongo) / JSON columns: raw objects for a tree view; null otherwise. */
  documents: Record<string, unknown>[] | null
}

/** Everything a driver needs to open a connection. Password is resolved by main from the secret store. */
export interface ConnectParams {
  id: string
  type: ConnectionType
  host: string
  port: number
  username: string
  password: string | null
  database: string
  ssl: boolean
}

export interface RunOptions {
  /** Hard cap on returned rows; the driver applies it and sets `truncated`. */
  maxRows: number
  /** Caller-supplied id so an in-flight query can be cancelled. */
  queryId: string
}

/** A query to run: SQL text for relational drivers, a structured command for Mongo. */
export type QueryRequest =
  | { kind: 'sql'; sql: string }
  | { kind: 'mongo'; command: MongoCommand }

/** The contract every concrete driver (Plan 3b) implements. */
export interface DatabaseDriver {
  readonly type: ConnectionType
  /** Open a throwaway connection, verify it works, close it. Throws on failure. */
  testConnection(params: ConnectParams): Promise<void>
  /** Open and pool a connection keyed by params.id. Idempotent. */
  connect(params: ConnectParams): Promise<void>
  /** Close the pooled connection for this id (no-op if absent). */
  disconnect(id: string): Promise<void>
  /** Execute a request against the pooled connection, returning a normalized result. */
  runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult>
  /** Best-effort cancellation of an in-flight query by its RunOptions.queryId. */
  cancel(id: string, queryId: string): Promise<void>
}
```

- [ ] **Step 3: Write the test** `src/main/drivers/mongo/command.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isMongoOp, isMongoReadOp, assertMongoWritable } from './command'

describe('mongo command model', () => {
  it('recognizes known ops and rejects unknown', () => {
    expect(isMongoOp('find')).toBe(true)
    expect(isMongoOp('updateMany')).toBe(true)
    expect(isMongoOp('dropDatabase')).toBe(false)
    expect(isMongoOp('')).toBe(false)
  })

  it('classifies read vs write ops', () => {
    expect(isMongoReadOp('aggregate')).toBe(true)
    expect(isMongoReadOp('deleteOne')).toBe(false)
  })

  it('assertMongoWritable allows reads always, blocks writes only when read-only', () => {
    expect(() => assertMongoWritable('find', true)).not.toThrow()
    expect(() => assertMongoWritable('insertOne', false)).not.toThrow()
    expect(() => assertMongoWritable('insertOne', true)).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 4: Run + verify.** Run: `npx vitest run src/main/drivers/mongo/command.test.ts` (expect PASS, 3 tests) and `npm run typecheck` (clean — `types.ts` compiles against the existing `ConnectionType`).

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "feat: add driver contract types and Mongo command model"
```

---

## Task 2: SQL read-only guard (TDD)

The safety net behind the per-connection read-only flag: classify SQL and block anything that isn't a pure read. Conservative by design — when unsure, it blocks.

**Files:** Create `src/main/drivers/sql/readonly-guard.ts`, `src/main/drivers/sql/readonly-guard.test.ts`.

- [ ] **Step 1: Write the failing test** `src/main/drivers/sql/readonly-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isSqlReadOnly, assertSqlWritable, splitStatements } from './readonly-guard'

describe('splitStatements', () => {
  it('strips comments and splits on semicolons', () => {
    expect(splitStatements('SELECT 1; -- c\n SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
    expect(splitStatements('/* x */ SELECT 1')).toEqual(['SELECT 1'])
    expect(splitStatements('   ;  ')).toEqual([])
  })
})

describe('isSqlReadOnly', () => {
  it('allows pure reads', () => {
    expect(isSqlReadOnly('SELECT * FROM users')).toBe(true)
    expect(isSqlReadOnly('  select 1  ')).toBe(true)
    expect(isSqlReadOnly('SHOW TABLES')).toBe(true)
    expect(isSqlReadOnly('EXPLAIN SELECT * FROM t')).toBe(true)
    expect(isSqlReadOnly('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true)
    expect(isSqlReadOnly('SELECT 1; SELECT 2;')).toBe(true)
  })

  it('blocks writes and DDL', () => {
    expect(isSqlReadOnly('INSERT INTO t VALUES (1)')).toBe(false)
    expect(isSqlReadOnly('UPDATE t SET a=1')).toBe(false)
    expect(isSqlReadOnly('DELETE FROM t')).toBe(false)
    expect(isSqlReadOnly('DROP TABLE t')).toBe(false)
    expect(isSqlReadOnly('TRUNCATE t')).toBe(false)
    expect(isSqlReadOnly('SELECT 1; DELETE FROM t')).toBe(false)
  })

  it('blocks data-modifying CTEs and EXPLAIN ANALYZE (they execute writes)', () => {
    expect(isSqlReadOnly('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x')).toBe(false)
    expect(isSqlReadOnly('EXPLAIN ANALYZE DELETE FROM t')).toBe(false)
  })

  it('blocks unrecognized leading keywords (conservative)', () => {
    expect(isSqlReadOnly('GRANT ALL ON t TO bob')).toBe(false)
    expect(isSqlReadOnly('')).toBe(true) // empty is harmless
  })
})

describe('assertSqlWritable', () => {
  it('throws only when read-only and the sql writes', () => {
    expect(() => assertSqlWritable('DELETE FROM t', false)).not.toThrow()
    expect(() => assertSqlWritable('SELECT 1', true)).not.toThrow()
    expect(() => assertSqlWritable('DELETE FROM t', true)).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run src/main/drivers/sql/readonly-guard.test.ts` → expect FAIL (module missing).

- [ ] **Step 3: Create `src/main/drivers/sql/readonly-guard.ts`:**

```ts
const READ_LEADING = new Set(['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'DESCRIBE', 'DESC', 'VALUES', 'TABLE'])
const WRITE_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|TRUNCATE|DROP|CREATE|ALTER|RENAME|GRANT|REVOKE|REPLACE|CALL|EXEC|EXECUTE|DO|VACUUM|REINDEX|CLUSTER|LOCK|COPY|LOAD|IMPORT|ATTACH|DETACH|SET|RESET)\b/i

/** Remove block and line comments. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** Split into trimmed, non-empty statements on semicolons (best-effort, comments stripped first). */
export function splitStatements(sql: string): string[] {
  return stripSqlComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function leadingKeyword(stmt: string): string | null {
  const m = stmt.match(/^[A-Za-z]+/)
  return m ? m[0].toUpperCase() : null
}

/** True only if EVERY statement is a pure read (safe on a read-only connection). */
export function isSqlReadOnly(sql: string): boolean {
  for (const stmt of splitStatements(sql)) {
    const kw = leadingKeyword(stmt)
    if (!kw || !READ_LEADING.has(kw)) return false
    // WITH ... (data-modifying CTE) and EXPLAIN ANALYZE actually perform writes.
    if ((kw === 'WITH' || kw === 'EXPLAIN') && WRITE_RE.test(stmt)) return false
    if (kw === 'EXPLAIN' && /\bANALYZE\b/i.test(stmt)) return false
    // SELECT ... INTO creates a table (Postgres) or writes a file (MySQL INTO OUTFILE/DUMPFILE).
    if (kw === 'SELECT' && /\bINTO\b/i.test(stmt)) return false
  }
  return true
}

/** Throw if a write/DDL statement is issued on a read-only connection. */
export function assertSqlWritable(sql: string, readOnly: boolean): void {
  if (readOnly && !isSqlReadOnly(sql)) {
    throw new Error('This connection is read-only — only SELECT/read statements are allowed.')
  }
}
```

> Note the deliberate limitation (document, don't fix here): semicolons or write-keywords appearing inside string literals can cause over-blocking. That's acceptable for a safety net — it errs toward blocking, never toward letting a write through. A proper tokenizer can replace this later if it proves annoying.

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/main/drivers/sql/readonly-guard.test.ts` → expect PASS.

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "feat: add SQL read-only guard (statement classification)"
```

---

## Task 3: MongoDB raw-JSON command parser (TDD)

Parses the raw-JSON query mode into a validated `MongoCommand`, with clear per-op errors. (EJSON values like `{"$oid": "..."}` are left as plain objects here — the Mongo driver in 3b converts them via the official driver's EJSON.)

**Files:** Create `src/main/drivers/mongo/raw.ts`, `src/main/drivers/mongo/raw.test.ts`.

- [ ] **Step 1: Write the failing test** `src/main/drivers/mongo/raw.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseMongoJson } from './raw'

describe('parseMongoJson', () => {
  it('parses a find with filter/projection/sort/limit/skip', () => {
    const cmd = parseMongoJson(JSON.stringify({
      op: 'find', collection: 'users',
      filter: { age: { $gt: 21 } }, projection: { name: 1 }, sort: { name: 1 }, limit: 50, skip: 10
    }))
    expect(cmd).toEqual({
      op: 'find', collection: 'users',
      filter: { age: { $gt: 21 } }, projection: { name: 1 }, sort: { name: 1 }, limit: 50, skip: 10
    })
  })

  it('parses aggregate with a pipeline', () => {
    const cmd = parseMongoJson(JSON.stringify({ op: 'aggregate', collection: 'orders', pipeline: [{ $match: { x: 1 } }] }))
    expect(cmd.op).toBe('aggregate')
    expect(cmd.pipeline).toEqual([{ $match: { x: 1 } }])
  })

  it('parses distinct / insertOne / updateOne / deleteMany', () => {
    expect(parseMongoJson(JSON.stringify({ op: 'distinct', collection: 'c', field: 'country' })).field).toBe('country')
    expect(parseMongoJson(JSON.stringify({ op: 'insertOne', collection: 'c', document: { a: 1 } })).document).toEqual({ a: 1 })
    const upd = parseMongoJson(JSON.stringify({ op: 'updateOne', collection: 'c', filter: { a: 1 }, update: { $set: { a: 2 } } }))
    expect(upd.update).toEqual({ $set: { a: 2 } })
    expect(parseMongoJson(JSON.stringify({ op: 'deleteMany', collection: 'c', filter: { a: 1 } })).filter).toEqual({ a: 1 })
  })

  it('rejects invalid JSON, unknown op, missing collection, and bad field types', () => {
    expect(() => parseMongoJson('{not json')).toThrow(/invalid json/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'nope', collection: 'c' }))).toThrow(/op/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: '' }))).toThrow(/collection/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'find', collection: 'c', limit: 'x' }))).toThrow(/limit/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'aggregate', collection: 'c' }))).toThrow(/pipeline/i)
    expect(() => parseMongoJson(JSON.stringify({ op: 'insertOne', collection: 'c' }))).toThrow(/document/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run src/main/drivers/mongo/raw.test.ts` → expect FAIL.

- [ ] **Step 3: Create `src/main/drivers/mongo/raw.ts`:**

```ts
import { type MongoCommand, type MongoOp, isMongoOp } from './command'

function asObject(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`'${field}' must be an object`)
  }
  return v as Record<string, unknown>
}

function asNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`'${field}' must be a number`)
  return v
}

/** Parse the raw-JSON query mode into a validated MongoCommand. */
export function parseMongoJson(input: string): MongoCommand {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Command must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.op !== 'string' || !isMongoOp(obj.op)) {
    throw new Error(`Unknown or missing 'op' (got ${JSON.stringify(obj.op)})`)
  }
  const op = obj.op as MongoOp
  if (typeof obj.collection !== 'string' || obj.collection.length === 0) {
    throw new Error(`'collection' must be a non-empty string`)
  }

  const cmd: MongoCommand = { op, collection: obj.collection }

  switch (op) {
    case 'find':
    case 'findOne':
    case 'count':
    case 'countDocuments': {
      if (obj.filter !== undefined) cmd.filter = asObject(obj.filter, 'filter')
      if (obj.projection !== undefined) cmd.projection = asObject(obj.projection, 'projection')
      if (obj.sort !== undefined) cmd.sort = asObject(obj.sort, 'sort')
      if (obj.limit !== undefined) cmd.limit = asNumber(obj.limit, 'limit')
      if (obj.skip !== undefined) cmd.skip = asNumber(obj.skip, 'skip')
      break
    }
    case 'aggregate': {
      if (!Array.isArray(obj.pipeline)) throw new Error(`'aggregate' requires a 'pipeline' array`)
      cmd.pipeline = obj.pipeline.map((s, i) => asObject(s, `pipeline[${i}]`))
      break
    }
    case 'distinct': {
      if (typeof obj.field !== 'string' || obj.field.length === 0) {
        throw new Error(`'distinct' requires a 'field' string`)
      }
      cmd.field = obj.field
      if (obj.filter !== undefined) cmd.filter = asObject(obj.filter, 'filter')
      break
    }
    case 'insertOne': {
      cmd.document = asObject(obj.document, 'document')
      break
    }
    case 'insertMany': {
      if (!Array.isArray(obj.documents)) throw new Error(`'insertMany' requires a 'documents' array`)
      cmd.documents = obj.documents.map((d, i) => asObject(d, `documents[${i}]`))
      break
    }
    case 'updateOne':
    case 'updateMany': {
      cmd.filter = asObject(obj.filter, 'filter')
      cmd.update = asObject(obj.update, 'update')
      break
    }
    case 'replaceOne': {
      cmd.filter = asObject(obj.filter, 'filter')
      cmd.replacement = asObject(obj.replacement, 'replacement')
      break
    }
    case 'deleteOne':
    case 'deleteMany': {
      cmd.filter = asObject(obj.filter, 'filter')
      break
    }
  }
  return cmd
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/main/drivers/mongo/raw.test.ts` → expect PASS.

- [ ] **Step 5: Full gate + commit.**
```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add MongoDB raw-JSON command parser with per-op validation"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (for this slice):** `DatabaseDriver` contract + normalized `QueryResult` ✓ T1; read-only guard ✓ T2 (SQL) + T1 (Mongo op allow-list); Mongo raw-JSON translation ✓ T3. Concrete `pg`/`mysql2`/`mongodb` drivers + normalized-result *population* + cancellation + IPC wiring are Plan 3b; the `mongosh` shell parser is Plan 3c.
- **No new dependencies / no DB:** every unit is pure TS, unit-tested under Node — no Docker, no native modules, no Electron.
- **Placeholder scan:** none; full code + exact commands throughout. The one documented limitation (string-literal edge case in the SQL splitter) is intentional and safe-by-blocking.
- **Type consistency:** `MongoCommand`/`MongoOp` defined once in `mongo/command.ts` and reused by `raw.ts` and `types.ts`’s `QueryRequest`; `ConnectionType` reused from `shared/domain.ts`; `QueryResult`/`ConnectParams`/`RunOptions` are the exact shapes Plan 3b drivers must satisfy.
- **Carried to Plan 3b (from review):** the Mongo op allow-list blocks write *ops*, but `aggregate` is a read op that can still write via `$out`/`$merge` pipeline stages — 3b's Mongo driver must scan the pipeline and treat `$out`/`$merge` as writes under a read-only connection. `ConnectParams` will likely need Mongo-specific fields (authSource/replicaSet); the `rows[][]` tabular shape needs a documented key-union policy for heterogeneous documents.

## Definition of Done

`npm run typecheck`, `npm run lint`, and `npm test` all pass with the new guard/parser/command tests green. The `DatabaseDriver` interface and `QueryResult` shape are defined and compile. On green → **Plan 3b — Concrete drivers (pg/mysql2/mongodb) + testcontainers integration + IPC wiring**, which implements `DatabaseDriver` and is where Docker-backed integration testing lands.
