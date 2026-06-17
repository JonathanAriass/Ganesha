# Editable query results — Phase A (SQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Postgres/MySQL/MariaDB query results editable in place — double-click a cell to edit, changed cells highlight as pending, and a per-connection `requireCommit` setting decides whether edits write immediately or wait for an explicit Commit.

**Architecture:** A new `EditableResult` descriptor on `QueryResult` (derived in each SQL driver from the column metadata it already receives + a cached primary-key lookup) tells the renderer which cells are editable and how to key a row. A dedicated `edits.apply` IPC channel sends *structured* edits to the driver, which builds parameterized `UPDATE … WHERE <pk>` statements in one transaction (each must affect exactly one row). The renderer stages edits in a dirty map and commits via that channel. Pure logic (`edit-target.ts`, `update-builder.ts`, `edit-staging.ts`) is unit-tested; the apply path is integration-tested against real databases.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, `pg`, `mysql2`, better-sqlite3, TanStack Table, Vitest + testcontainers.

**Scope (Phase A):** SQL only. Edit existing cell values only — no insert/delete. PK cells read-only. Mongo editing is Phase B (separate plan). Editing is the primary `ResultsGrid` only (not `ScriptResults`).

---

### Task 1: `requireCommit` connection field + persistence

**Files:**
- Modify: `src/shared/domain.ts` (add field to `ConnectionInput`)
- Modify: `src/main/persistence/db.ts` (migration)
- Modify: `src/main/persistence/connections.ts` (Row, toConfig, create, update)
- Test: `src/main/persistence/connections.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/persistence/connections.test.ts` (follow the file's existing imports/`makeInput` style; if it has a helper that builds a `ConnectionInput`, add `requireCommit` there too):

```ts
it('round-trips requireCommit (defaults true for legacy rows via migration)', () => {
  const c = createConnection(db, { ...baseInput, requireCommit: false }, 1)
  expect(c.requireCommit).toBe(false)
  const updated = updateConnection(db, c.id, { requireCommit: true }, 2)
  expect(updated.requireCommit).toBe(true)
})
```

(`baseInput` = whatever the test already uses for a valid `ConnectionInput`; add `requireCommit: true` to it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/persistence/connections.test.ts`
Expected: FAIL — `requireCommit` missing on the type / `undefined` at runtime.

- [ ] **Step 3: Add the field to the domain type**

In `src/shared/domain.ts`, inside `ConnectionInput`, after `readOnly: boolean`:

```ts
  /** When true, table-cell edits stage until an explicit commit instead of writing
   *  immediately ("prevent fast commit"). Ignored on read-only connections. */
  requireCommit: boolean
```

- [ ] **Step 4: Add the migration**

In `src/main/persistence/db.ts`, in `migrate()` next to the other `addColumnIfMissing` calls:

```ts
  // Editable-results commit safety (added later): default ON = require explicit commit.
  addColumnIfMissing(db, 'connections', 'require_commit', 'INTEGER NOT NULL DEFAULT 1')
```

- [ ] **Step 5: Carry it through the mappers**

In `src/main/persistence/connections.ts`:
- Add to `interface Row`: `require_commit: number`
- In `toConfig`, add to the returned object: `requireCommit: !!r.require_commit,`
- In `createConnection`'s INSERT, add `require_commit` to the column list and `@requireCommit` to VALUES, and in `.run({...})` add `requireCommit: input.requireCommit ? 1 : 0,`
- In `updateConnection`'s UPDATE SET, add `require_commit=@requireCommit,` and in `.run({...})` add `requireCommit: next.requireCommit ? 1 : 0,`

Concretely the INSERT becomes:
```ts
  db.prepare(`INSERT INTO connections
    (id,type,name,color,host,port,username,db_name,ssl,read_only,require_commit,auth_source,replica_set,ssh_json,created_at,updated_at)
    VALUES (@id,@type,@name,@color,@host,@port,@username,@database,@ssl,@readOnly,@requireCommit,@authSource,@replicaSet,@ssh_json,@now,@now)`)
    .run({ id, ...flat, ssl: input.ssl ? 1 : 0, readOnly: input.readOnly ? 1 : 0, requireCommit: input.requireCommit ? 1 : 0, ssh_json: ssh ? JSON.stringify(ssh) : null, now })
```
and the UPDATE SET adds `require_commit=@requireCommit,` with `.run({ ...next, id, ssl: next.ssl ? 1 : 0, readOnly: next.readOnly ? 1 : 0, requireCommit: next.requireCommit ? 1 : 0, ssh_json: next.ssh ? JSON.stringify(next.ssh) : null, now })`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/main/persistence/connections.test.ts`
Expected: PASS. Also grep for other `ConnectionInput` literals that now miss the field:
Run: `npx tsc --noEmit -p tsconfig.node.json 2>&1 | head` — fix any object literal missing `requireCommit` (e.g. test fixtures, `query-service.test.ts`'s `input`) by adding `requireCommit: true`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/domain.ts src/main/persistence/db.ts src/main/persistence/connections.ts src/main/persistence/connections.test.ts
git commit -m "feat: requireCommit connection field + migration"
```

---

### Task 2: `requireCommit` checkbox in ConnectionModal

**Files:**
- Modify: `src/renderer/src/components/ConnectionModal.tsx`

- [ ] **Step 1: Find the read-only control + form state**

Run: `grep -n "readOnly\|read-only\|Read-only\|requireCommit\|useState\|checkbox-row" src/renderer/src/components/ConnectionModal.tsx`
This shows how the form state object is built and where the Read-only checkbox is rendered (the new control goes right after it, and the new field must be seeded in the initial state from the editing connection or default `true`).

- [ ] **Step 2: Seed the field in form state**

Wherever the modal initializes its form object from an existing connection or defaults (the `useState`/initial object), add `requireCommit: editing?.requireCommit ?? true,` (match the file's existing field-seeding idiom — if it spreads an `editing` connection, also ensure new-connection defaults include `requireCommit: true`).

- [ ] **Step 3: Render the checkbox after the Read-only row**

Right after the Read-only `.checkbox-row`, add (matching the existing checkbox-row markup in this file):

```tsx
<label className="checkbox-row">
  <input
    type="checkbox"
    checked={form.requireCommit}
    disabled={form.readOnly}
    onChange={(e) => setForm({ ...form, requireCommit: e.target.checked })}
  />
  <span>
    Require explicit commit for cell edits
    <span className="hint"> — prevent fast commit/push; edits stage until you click Commit</span>
  </span>
</label>
```

(Use the same `setForm`/state-updater the file already uses. `.hint` class may already exist; if not, plain text is fine.)

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ConnectionModal.tsx
git commit -m "feat: requireCommit checkbox in connection modal"
```

---

### Task 3: `EditableResult` + `RowEdit` shared types

**Files:**
- Modify: `src/shared/query.ts`

- [ ] **Step 1: Add the types**

In `src/shared/query.ts`, add above `QueryResult` and a new field inside it:

```ts
export interface EditableResult {
  table: { schema: string | null; name: string }
  /** Real base-table columns forming the row key (SQL primary key; Mongo ['_id']). */
  keyColumns: string[]
  /** Per result-column index: the real base-table column it maps to, or null for an
   *  expression/joined/computed column. Editable = non-null and not in keyColumns. */
  columnSources: (string | null)[]
}

/** One row's edit: the original key (WHERE) and the changed columns (SET). Values are
 *  the raw cell values; the driver binds them as parameters. */
export interface RowEdit {
  key: Record<string, unknown>
  set: Record<string, unknown>
}
```

Then inside `QueryResult` add:
```ts
  /** Present only for a result over one editable table/collection whose key is in the
   *  result AND the connection is not read-only. null = the grid is read-only. */
  editable: EditableResult | null
```

- [ ] **Step 2: Make existing result builders compile**

Run: `npx tsc --noEmit -p tsconfig.node.json 2>&1 | head -30`
Every place that constructs a `QueryResult` now needs `editable`. Add `editable: null` to: `postgres.ts` runQuery return, `mysql.ts` runQuery return, `mongo.ts` runQuery return(s), and the `fakeResult` in `src/main/query-service.test.ts` and any other test building a `QueryResult`. (Tasks 5–6 set a real value for pg/mysql; `null` is the correct default everywhere else.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/shared/query.ts src/main/drivers/sql/postgres.ts src/main/drivers/sql/mysql.ts src/main/drivers/mongo/mongo.ts src/main/query-service.test.ts
git commit -m "feat: EditableResult/RowEdit types; default editable=null in all drivers"
```

---

### Task 4: Pure `buildEditableResult` assembler

**Files:**
- Create: `src/main/drivers/sql/edit-target.ts`
- Test: `src/main/drivers/sql/edit-target.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildEditableResult, type PerColumnSource } from './edit-target'

const T = { schema: 'public', name: 'users' }
const cols = (...c: (string | null)[]): PerColumnSource[] =>
  c.map((column) => (column === null ? { table: null, column: null } : { table: T, column }))

describe('buildEditableResult', () => {
  it('builds a descriptor for a single-table result with its PK present', () => {
    expect(buildEditableResult(cols('id', 'name', 'email'), ['id'])).toEqual({
      table: T,
      keyColumns: ['id'],
      columnSources: ['id', 'name', 'email']
    })
  })
  it('marks expression columns (null source) as non-editable but still editable overall', () => {
    expect(buildEditableResult([...cols('id', 'name'), { table: null, column: null }], ['id'])).toEqual({
      table: T,
      keyColumns: ['id'],
      columnSources: ['id', 'name', null]
    })
  })
  it('returns null when more than one source table is present', () => {
    const mixed: PerColumnSource[] = [
      { table: T, column: 'id' },
      { table: { schema: 'public', name: 'orders' }, column: 'id' }
    ]
    expect(buildEditableResult(mixed, ['id'])).toBeNull()
  })
  it('returns null when there is no source table at all', () => {
    expect(buildEditableResult([{ table: null, column: null }], ['id'])).toBeNull()
  })
  it('returns null when the table has no primary key', () => {
    expect(buildEditableResult(cols('id', 'name'), [])).toBeNull()
  })
  it('returns null when a PK column is absent from the result', () => {
    expect(buildEditableResult(cols('name', 'email'), ['id'])).toBeNull()
  })
  it('supports a composite primary key', () => {
    expect(buildEditableResult(cols('a', 'b', 'v'), ['a', 'b'])).toEqual({
      table: T,
      keyColumns: ['a', 'b'],
      columnSources: ['a', 'b', 'v']
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/drivers/sql/edit-target.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { EditableResult } from '../../../shared/query'

export interface TableId { schema: string | null; name: string }
export interface PerColumnSource { table: TableId | null; column: string | null }

function sameTable(a: TableId, b: TableId): boolean {
  return a.name === b.name && a.schema === b.schema
}

/** Assemble an EditableResult from each result column's resolved source and the source
 *  table's primary-key columns. Returns null (read-only) unless the result maps to
 *  exactly one source table whose full PK is present among the columns. */
export function buildEditableResult(perColumn: PerColumnSource[], pkColumns: string[]): EditableResult | null {
  const tables = perColumn.map((c) => c.table).filter((t): t is TableId => t !== null)
  if (tables.length === 0) return null
  const table = tables[0]
  if (!tables.every((t) => sameTable(t, table))) return null
  if (pkColumns.length === 0) return null

  const columnSources = perColumn.map((c) => (c.table && sameTable(c.table, table) ? c.column : null))
  if (!pkColumns.every((pk) => columnSources.includes(pk))) return null

  return { table, keyColumns: pkColumns, columnSources }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/drivers/sql/edit-target.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/sql/edit-target.ts src/main/drivers/sql/edit-target.test.ts
git commit -m "feat: pure buildEditableResult assembler"
```

---

### Task 5: Pure `update-builder` (parameterized UPDATE per dialect)

**Files:**
- Create: `src/main/drivers/sql/update-builder.ts`
- Test: `src/main/drivers/sql/update-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildUpdate } from './update-builder'

const T = { schema: 'public', name: 'users' }

describe('buildUpdate (postgres)', () => {
  it('builds a parameterized UPDATE with $n placeholders and quoted identifiers', () => {
    const r = buildUpdate('postgres', T, { key: { id: 7 }, set: { name: 'Ann', email: 'a@x.io' } })
    expect(r.sql).toBe('UPDATE "public"."users" SET "name" = $1, "email" = $2 WHERE "id" = $3')
    expect(r.params).toEqual(['Ann', 'a@x.io', 7])
  })
  it('uses IS NULL for a null key value (never = NULL)', () => {
    const r = buildUpdate('postgres', T, { key: { id: 7, tenant: null }, set: { v: 1 } })
    expect(r.sql).toBe('UPDATE "public"."users" SET "v" = $1 WHERE "id" = $2 AND "tenant" IS NULL')
    expect(r.params).toEqual([1, 7])
  })
  it('binds a null SET value as a parameter (sets the column NULL)', () => {
    const r = buildUpdate('postgres', T, { key: { id: 7 }, set: { note: null } })
    expect(r.sql).toBe('UPDATE "public"."users" SET "note" = $1 WHERE "id" = $2')
    expect(r.params).toEqual([null, 7])
  })
  it('omits the schema when null', () => {
    const r = buildUpdate('postgres', { schema: null, name: 't' }, { key: { id: 1 }, set: { v: 2 } })
    expect(r.sql).toBe('UPDATE "t" SET "v" = $1 WHERE "id" = $2')
  })
})

describe('buildUpdate (mysql)', () => {
  it('uses ? placeholders and backtick identifiers', () => {
    const r = buildUpdate('mysql', { schema: 'app', name: 'users' }, { key: { id: 7 }, set: { name: 'Ann' } })
    expect(r.sql).toBe('UPDATE `app`.`users` SET `name` = ? WHERE `id` = ?')
    expect(r.params).toEqual(['Ann', 7])
  })
  it('escapes embedded quote characters in identifiers', () => {
    const r = buildUpdate('mysql', { schema: null, name: 'we`ird' }, { key: { id: 1 }, set: { 'c`ol': 2 } })
    expect(r.sql).toBe('UPDATE `we``ird` SET `c``ol` = ? WHERE `id` = ?')
  })
  it('throws when there are no SET columns', () => {
    expect(() => buildUpdate('mysql', T, { key: { id: 1 }, set: {} })).toThrow(/no columns/i)
  })
  it('throws when there are no key columns', () => {
    expect(() => buildUpdate('mysql', T, { key: {}, set: { v: 1 } })).toThrow(/no key/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/drivers/sql/update-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { RowEdit } from '../../../shared/query'

export type SqlDialect = 'postgres' | 'mysql'

interface BuiltUpdate { sql: string; params: unknown[] }

function quoteIdent(dialect: SqlDialect, ident: string): string {
  if (dialect === 'postgres') return `"${ident.replace(/"/g, '""')}"`
  return `\`${ident.replace(/`/g, '``')}\``
}

function qualified(dialect: SqlDialect, table: { schema: string | null; name: string }): string {
  const name = quoteIdent(dialect, table.name)
  return table.schema ? `${quoteIdent(dialect, table.schema)}.${name}` : name
}

/** Build a single parameterized UPDATE for one row. Placeholders are $n (postgres) or
 *  ? (mysql); a null key value becomes `IS NULL` (no param); a null SET value is bound
 *  as a parameter. Throws when there are no SET columns or no key columns. */
export function buildUpdate(
  dialect: SqlDialect,
  table: { schema: string | null; name: string },
  edit: RowEdit
): BuiltUpdate {
  const setCols = Object.keys(edit.set)
  const keyCols = Object.keys(edit.key)
  if (setCols.length === 0) throw new Error('buildUpdate: no columns to set')
  if (keyCols.length === 0) throw new Error('buildUpdate: no key columns to match')

  const params: unknown[] = []
  const ph = (): string => (dialect === 'postgres' ? `$${params.length}` : '?')

  const setSql = setCols
    .map((c) => {
      params.push(edit.set[c])
      return `${quoteIdent(dialect, c)} = ${ph()}`
    })
    .join(', ')

  const whereSql = keyCols
    .map((c) => {
      const v = edit.key[c]
      if (v === null || v === undefined) return `${quoteIdent(dialect, c)} IS NULL`
      params.push(v)
      return `${quoteIdent(dialect, c)} = ${ph()}`
    })
    .join(' AND ')

  return { sql: `UPDATE ${qualified(dialect, table)} SET ${setSql} WHERE ${whereSql}`, params }
}
```

Note: `ph()` reads `params.length` *after* the push for `$n` (1-based) — verify the postgres test expects `$1,$2,$3` in order. For the SET branch the push happens before `ph()`, giving the correct 1-based index.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/drivers/sql/update-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/sql/update-builder.ts src/main/drivers/sql/update-builder.test.ts
git commit -m "feat: pure parameterized UPDATE builder (pg/mysql)"
```

---

### Task 6: Driver `applyEdits` + `editable` descriptor (Postgres)

**Files:**
- Modify: `src/main/drivers/types.ts` (interface)
- Modify: `src/main/drivers/sql/postgres.ts`
- Test: `src/main/drivers/sql/postgres.integration.test.ts`

- [ ] **Step 1: Add `applyEdits` to the driver interface**

In `src/main/drivers/types.ts`, import `RowEdit` (from `../../shared/query`) and add to `DatabaseDriver`:

```ts
  /** Apply staged cell edits to one table in a single transaction. Each row's UPDATE
   *  must affect exactly one row or the whole batch rolls back. Refuses when readOnly. */
  applyEdits(
    id: string,
    edits: { table: { schema: string | null; name: string }; rows: RowEdit[] },
    opts: { readOnly: boolean }
  ): Promise<{ updated: number }>
```
Re-export `RowEdit` alongside the existing `QueryResult` re-export.

- [ ] **Step 2: Write the failing integration test**

Add to `src/main/drivers/sql/postgres.integration.test.ts`:

```ts
it('applyEdits updates by primary key in a transaction', async () => {
  await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE t_edit (id int PRIMARY KEY, name text)' }, { maxRows: 1000, queryId: 'e1', readOnly: false })
  await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO t_edit VALUES (1,'a'),(2,'b')" }, { maxRows: 1000, queryId: 'e2', readOnly: false })

  const r = await driver.applyEdits(id, { table: { schema: 'public', name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'A' } }] }, { readOnly: false })
  expect(r.updated).toBe(1)
  const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT name FROM t_edit WHERE id=1' }, { maxRows: 10, queryId: 'e3', readOnly: false })
  expect(after.rows).toEqual([['A']])
})

it('applyEdits rolls back the whole batch when a row key matches nothing', async () => {
  await driver.runQuery(id, { kind: 'sql', sql: "UPDATE t_edit SET name='b' WHERE id=2" }, { maxRows: 10, queryId: 'e4', readOnly: false })
  await expect(
    driver.applyEdits(id, { table: { schema: 'public', name: 't_edit' }, rows: [
      { key: { id: 2 }, set: { name: 'B' } },
      { key: { id: 999 }, set: { name: 'X' } }
    ] }, { readOnly: false })
  ).rejects.toThrow(/affected 0 rows|exactly one/i)
  const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT name FROM t_edit WHERE id=2' }, { maxRows: 10, queryId: 'e5', readOnly: false })
  expect(after.rows).toEqual([['b']]) // first update rolled back
})

it('applyEdits refuses on a read-only request', async () => {
  await expect(
    driver.applyEdits(id, { table: { schema: 'public', name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'z' } }] }, { readOnly: true })
  ).rejects.toThrow(/read-only/i)
})

it('a single-table SELECT * reports an editable descriptor; a join does not', async () => {
  const sel = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT * FROM t_edit ORDER BY id' }, { maxRows: 10, queryId: 'e6', readOnly: false })
  expect(sel.editable).toEqual({ table: { schema: 'public', name: 't_edit' }, keyColumns: ['id'], columnSources: ['id', 'name'] })
  const join = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT t_edit.id, 1 AS k FROM t_edit, t_edit b' }, { maxRows: 10, queryId: 'e7', readOnly: false })
  expect(join.editable).toBeNull()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/main/drivers/sql/postgres.integration.test.ts --config vitest.integration.config.ts`
Expected: FAIL — `applyEdits` not implemented / `editable` is null.

- [ ] **Step 4: Implement the PK/table cache + descriptor in `postgres.ts`**

Add a private cache field on the driver class: `private tableMeta = new Map<string, Promise<{ schema: string; name: string; cols: Map<number, string>; pk: string[] } | null>>()` keyed by `${id}:${oid}`. Add a method that resolves a table oid once:

```ts
private resolvePgTable(client: import('pg').PoolClient | import('pg').Pool, id: string, oid: number): Promise<{ schema: string; name: string; cols: Map<number, string>; pk: string[] } | null> {
  const key = `${id}:${oid}`
  let p = this.tableMeta.get(key)
  if (!p) {
    p = (async () => {
      const meta = await client.query(
        `SELECT c.relname AS name, n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1`, [oid])
      if (meta.rowCount === 0) return null
      const attrs = await client.query(
        `SELECT attnum, attname FROM pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped`, [oid])
      const cols = new Map<number, string>(attrs.rows.map((r: any) => [r.attnum as number, r.attname as string]))
      const pkRes = await client.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1 AND i.indisprimary ORDER BY a.attnum`, [oid])
      return { name: meta.rows[0].name as string, schema: meta.rows[0].schema as string, cols, pk: pkRes.rows.map((r: any) => r.attname as string) }
    })().catch(() => null)
    this.tableMeta.set(key, p)
  }
  return p
}
```

After computing `columns`/`rows` in `runQuery`, derive the descriptor (only for non-readOnly connections, since read-only never edits — but it is safe to always compute; gate in the IPC/UX by `config.readOnly`. To match the spec, compute it and let the UX gate; simpler: always compute):

```ts
import { buildEditableResult, type PerColumnSource } from './edit-target'
// …after building `columns` and `rows`, before `return`:
const oids = [...new Set(fields.map((f) => f.tableID).filter((t) => t && t > 0))]
let editable = null as QueryResult['editable']
if (oids.length === 1) {
  const meta = await this.resolvePgTable(client, id, oids[0])
  if (meta) {
    const perColumn: PerColumnSource[] = fields.map((f) =>
      f.tableID === oids[0] && meta.cols.has(f.columnID)
        ? { table: { schema: meta.schema, name: meta.name }, column: meta.cols.get(f.columnID)! }
        : { table: null, column: null }
    )
    editable = buildEditableResult(perColumn, meta.pk)
  }
}
```
Add `editable` to the returned object (replace the `editable: null` from Task 3).

Note: `f.tableID`/`f.columnID` exist on node-postgres `FieldDef`. If TS complains, they are typed; otherwise cast `fields as Array<{ name: string; dataTypeID: number; tableID: number; columnID: number }>`.

- [ ] **Step 5: Implement `applyEdits` in `postgres.ts`**

```ts
import { buildUpdate } from './update-builder'
// …
async applyEdits(id: string, edits: { table: { schema: string | null; name: string }; rows: RowEdit[] }, opts: { readOnly: boolean }): Promise<{ updated: number }> {
  if (opts.readOnly) throw new Error('Connection is read-only: edits are blocked')
  const pool = this.pools.get(id)
  if (!pool) throw new Error(`Connection '${id}' is not open`)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let updated = 0
    for (const row of edits.rows) {
      const { sql, params } = buildUpdate('postgres', edits.table, row)
      const res = await client.query({ text: sql, values: params })
      if (res.rowCount !== 1) throw new Error(`Edit affected ${res.rowCount} rows (expected exactly one) — the row may have changed; refresh and retry`)
      updated += res.rowCount
    }
    await client.query('COMMIT')
    return { updated }
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* already aborted */ }
    throw e
  } finally {
    client.release()
  }
}
```
(Use the same `RowEdit` import in the file; import from `../../../shared/query`.)

- [ ] **Step 6: Run the integration test**

Run: `npx vitest run src/main/drivers/sql/postgres.integration.test.ts --config vitest.integration.config.ts`
Expected: PASS (requires Docker).

- [ ] **Step 7: Commit**

```bash
git add src/main/drivers/types.ts src/main/drivers/sql/postgres.ts src/main/drivers/sql/postgres.integration.test.ts
git commit -m "feat: postgres applyEdits + editable descriptor"
```

---

### Task 7: Driver `applyEdits` + `editable` descriptor (MySQL/MariaDB)

**Files:**
- Modify: `src/main/drivers/sql/mysql.ts`
- Test: `src/main/drivers/sql/mysql.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Mirror Task 6's tests in `mysql.integration.test.ts` but with mysql types and `container.getDatabase()` as the schema. Key differences: table `t_edit (id INT PRIMARY KEY, name VARCHAR(50))`; the editable descriptor's `table.schema` is `container.getDatabase()`. Read-only refusal and the exactly-one-row rollback assertions are identical in spirit. Example for the descriptor case:

```ts
it('a single-table SELECT reports an editable descriptor', async () => {
  await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE t_edit (id INT PRIMARY KEY, name VARCHAR(50))' }, { maxRows: 1000, queryId: 'm1', readOnly: false })
  await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO t_edit VALUES (1,'a')" }, { maxRows: 1000, queryId: 'm2', readOnly: false })
  const sel = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT id, name FROM t_edit' }, { maxRows: 10, queryId: 'm3', readOnly: false })
  expect(sel.editable).toEqual({ table: { schema: container.getDatabase(), name: 't_edit' }, keyColumns: ['id'], columnSources: ['id', 'name'] })
})

it('applyEdits updates by primary key', async () => {
  const r = await driver.applyEdits(id, { table: { schema: container.getDatabase(), name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'A' } }] }, { readOnly: false })
  expect(r.updated).toBe(1)
})

it('applyEdits refuses on read-only', async () => {
  await expect(driver.applyEdits(id, { table: { schema: container.getDatabase(), name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'z' } }] }, { readOnly: true })).rejects.toThrow(/read-only/i)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/drivers/sql/mysql.integration.test.ts --config vitest.integration.config.ts`
Expected: FAIL.

- [ ] **Step 3: Implement descriptor in `mysql.ts` runQuery**

mysql2 `FieldPacket` exposes `orgTable`, `orgName`, `db`/`schema`. Add a cached PK lookup keyed by `${id}:${db}.${table}`:

```ts
private pkCache = new Map<string, Promise<string[]>>()
private pkColumns(conn: import('mysql2/promise').PoolConnection, id: string, db: string, table: string): Promise<string[]> {
  const key = `${id}:${db}.${table}`
  let p = this.pkCache.get(key)
  if (!p) {
    p = (async () => {
      const [rows] = await conn.query(
        `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
         WHERE CONSTRAINT_NAME='PRIMARY' AND TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [db, table])
      return (rows as Array<{ c: string }>).map((r) => r.c)
    })().catch(() => [] as string[])
    this.pkCache.set(key, p)
  }
  return p
}
```

In `runQuery`, after building `columns`/`rows` (the `fields` array is in scope), derive the descriptor:

```ts
import { buildEditableResult, type PerColumnSource } from './edit-target'
// fields here are mysql.FieldPacket[]; orgTable/orgName/db are present at runtime
const fds = fields as unknown as Array<{ orgTable?: string; orgName?: string; db?: string }>
const tables = [...new Set(fds.map((f) => f.orgTable).filter((t): t is string => !!t))]
let editable = null as QueryResult['editable']
if (tables.length === 1) {
  const db = fds.find((f) => f.orgTable === tables[0])?.db ?? ''
  const pk = await this.pkColumns(conn, id, db, tables[0])
  const perColumn: PerColumnSource[] = fds.map((f) =>
    f.orgTable === tables[0] && f.orgName ? { table: { schema: db, name: tables[0] }, column: f.orgName } : { table: null, column: null }
  )
  editable = buildEditableResult(perColumn, pk)
}
```
Add `editable` to the returned object. (`conn` is the pooled connection acquired in `runQuery`; if it is released before this point, compute the descriptor before releasing.)

- [ ] **Step 4: Implement `applyEdits` in `mysql.ts`**

```ts
import { buildUpdate } from './update-builder'
// …
async applyEdits(id: string, edits: { table: { schema: string | null; name: string }; rows: RowEdit[] }, opts: { readOnly: boolean }): Promise<{ updated: number }> {
  if (opts.readOnly) throw new Error('Connection is read-only: edits are blocked')
  const pool = this.pools.get(id)
  if (!pool) throw new Error(`Connection '${id}' is not open`)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    let updated = 0
    for (const row of edits.rows) {
      const { sql, params } = buildUpdate('mysql', edits.table, row)
      const [res] = await conn.query(sql, params)
      const affected = (res as { affectedRows?: number }).affectedRows ?? 0
      if (affected !== 1) throw new Error(`Edit affected ${affected} rows (expected exactly one) — the row may have changed; refresh and retry`)
      updated += affected
    }
    await conn.commit()
    return { updated }
  } catch (e) {
    try { await conn.rollback() } catch { /* ignore */ }
    throw e
  } finally {
    conn.release()
  }
}
```

Note on MySQL: an UPDATE that matches a row but changes nothing reports `affectedRows: 0` by default. To make "matched exactly one" reliable, the pool is created with `CLIENT_FOUND_ROWS`. Check `src/main/drivers/sql/mysql.ts` pool config — if `flags`/`foundRows` isn't set, add `foundRows: true` to the `mysql.createPool({...})` options so `affectedRows` reflects matched rows. Add a test note. (mysql2 supports `foundRows: true`.)

- [ ] **Step 5: Run the integration test**

Run: `npx vitest run src/main/drivers/sql/mysql.integration.test.ts --config vitest.integration.config.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/drivers/sql/mysql.ts src/main/drivers/sql/mysql.integration.test.ts
git commit -m "feat: mysql applyEdits + editable descriptor (foundRows for exact match)"
```

---

### Task 8: `edits.apply` IPC channel

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`
- Test: covered by integration (driver) + manual; add a fakeDriver entry where needed

- [ ] **Step 1: Add the channel type**

In `src/shared/ipc.ts`, add to the channels map (import `RowEdit` from `./query`):

```ts
  'edits.apply': {
    req: { connectionId: string; table: { schema: string | null; name: string }; rows: RowEdit[] }
    res: { updated: number }
  }
```

- [ ] **Step 2: Add the api wrapper**

In `src/shared/api.ts`, add (matching the file's existing method style):

```ts
  edits: {
    apply: (req: Req<'edits.apply'>) => Promise<IpcResult<'edits.apply'>>
  }
```
and in `src/preload/index.ts` add to the exposed object:
```ts
  edits: { apply: (req) => invoke('edits.apply', req) },
```
(match the exact `invoke` helper and typing the preload already uses for other grouped channels like `schema`.)

- [ ] **Step 3: Add the main handler**

In `src/main/ipc.ts`, near the other `handle(...)` calls:

```ts
  handle('edits.apply', async ({ connectionId, table, rows }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    if (c.readOnly) throw new Error('Connection is read-only: edits are blocked')
    const driver = drivers.get(c.type)
    await connectStored(driver, c, secrets)
    return ok(await driver.applyEdits(c.id, { table, rows }, { readOnly: c.readOnly }))
  })
```

- [ ] **Step 4: Satisfy the driver interface in test fakes**

Run: `npx tsc --noEmit -p tsconfig.node.json 2>&1 | head`
`src/main/query-service.test.ts`'s `fakeDriver` now misses `applyEdits`. Add to it: `applyEdits: async () => ({ updated: 0 }),`. Fix any other `DatabaseDriver` fake the same way.

- [ ] **Step 5: Typecheck + existing tests**

Run: `npm run typecheck && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts src/main/query-service.test.ts
git commit -m "feat: edits.apply IPC channel (read-only guarded)"
```

---

### Task 9: Renderer staging model (`edit-staging.ts`)

**Files:**
- Create: `src/renderer/src/lib/edit-staging.ts`
- Test: `src/renderer/src/lib/edit-staging.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { EditableResult } from '@shared/query'
import { dirtyKey, buildRowEdits } from './edit-staging'

const editable: EditableResult = {
  table: { schema: 'public', name: 'users' },
  keyColumns: ['id'],
  columnSources: ['id', 'name', 'email'] // result columns 0,1,2
}
const rows = [
  [1, 'a', 'a@x.io'],
  [2, 'b', 'b@x.io']
]

describe('dirtyKey', () => {
  it('keys by row id and column index', () => {
    expect(dirtyKey(0, 2)).toBe('0:2')
  })
})

describe('buildRowEdits', () => {
  it('groups dirty cells per row, reading key values from the row', () => {
    const dirty = new Map<string, unknown>([
      [dirtyKey(0, 1), 'AA'],
      [dirtyKey(0, 2), 'aa@x.io'],
      [dirtyKey(1, 1), 'BB']
    ])
    expect(buildRowEdits(dirty, rows, editable)).toEqual([
      { key: { id: 1 }, set: { name: 'AA', email: 'aa@x.io' } },
      { key: { id: 2 }, set: { name: 'BB' } }
    ])
  })
  it('ignores dirty entries on non-editable (null-source) columns', () => {
    const e2: EditableResult = { ...editable, columnSources: ['id', 'name', null] }
    const dirty = new Map<string, unknown>([[dirtyKey(0, 2), 'x']])
    expect(buildRowEdits(dirty, rows, e2)).toEqual([])
  })
  it('reads a composite key from the row', () => {
    const e3: EditableResult = { table: { schema: null, name: 't' }, keyColumns: ['a', 'b'], columnSources: ['a', 'b', 'v'] }
    const dirty = new Map<string, unknown>([[dirtyKey(0, 2), 9]])
    expect(buildRowEdits(dirty, [[10, 20, 30]], e3)).toEqual([{ key: { a: 10, b: 20 }, set: { v: 9 } }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/lib/edit-staging.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { EditableResult, RowEdit } from '@shared/query'

/** Dirty-map key: TanStack row id (original data index) + result-column index. The
 *  row-id basis means a staged edit survives re-sorting/filtering the grid. */
export function dirtyKey(rowIndex: number, colIndex: number): string {
  return `${rowIndex}:${colIndex}`
}

function colIndexOf(editable: EditableResult, realCol: string): number {
  return editable.columnSources.indexOf(realCol)
}

/** Turn the dirty map into per-row edits. Each row's key columns are read from the row's
 *  cells (via columnSources); dirty cells on null-source columns are ignored. */
export function buildRowEdits(
  dirty: Map<string, unknown>,
  rows: unknown[][],
  editable: EditableResult
): RowEdit[] {
  const byRow = new Map<number, RowEdit>()
  for (const [k, value] of dirty) {
    const [rowIndex, colIndex] = k.split(':').map(Number)
    const realCol = editable.columnSources[colIndex]
    if (!realCol || editable.keyColumns.includes(realCol)) continue // non-editable or key cell
    let edit = byRow.get(rowIndex)
    if (!edit) {
      const key: Record<string, unknown> = {}
      for (const kc of editable.keyColumns) key[kc] = rows[rowIndex][colIndexOf(editable, kc)]
      edit = { key, set: {} }
      byRow.set(rowIndex, edit)
    }
    edit.set[realCol] = value
  }
  return [...byRow.values()]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/lib/edit-staging.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/edit-staging.ts src/renderer/src/lib/edit-staging.test.ts
git commit -m "feat: renderer edit-staging (dirty map + RowEdit assembly)"
```

---

### Task 10: Store action to apply committed edits to result rows

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts` (if it exists; else add a focused test file)

- [ ] **Step 1: Write the failing test**

Find the store test (`grep -rl "useAppStore\|createStore" src/renderer/src/state/*.test.ts`). Add a test that, given a tab with a result, `applyResultEdits(tabId, [{rowIndex, colIndex, value}])` returns new rows with those cells replaced and a new `rows` reference. If no store test file exists, create `src/renderer/src/state/store.test.ts` importing the store factory the codebase uses (match how other store behaviors are tested — search for an existing pattern first).

```ts
it('applyResultEdits replaces the given cells with a new rows array', () => {
  const s = useAppStore.getState()
  // arrange a tab with a result (use the store's existing helpers to open a tab + finishRun)
  // … then:
  s.applyResultEdits(tabId, [{ rowIndex: 0, colIndex: 1, value: 'NEW' }])
  const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!
  expect(tab.result!.rows[0][1]).toBe('NEW')
})
```
(Adapt arrangement to the store's real API — look at how `finishRun` sets `tab.result`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `applyResultEdits` undefined.

- [ ] **Step 3: Implement the action**

In the store, add to the actions (mirror the immutable update style used by `finishRun`/`setTabText`). Replace only the targeted cells, producing new row arrays so React re-renders:

```ts
applyResultEdits: (tabId, edits) =>
  set((s) => ({
    tabs: s.tabs.map((t) => {
      if (t.id !== tabId || !t.result) return t
      const touched = new Set(edits.map((e) => e.rowIndex))
      const rows = t.result.rows.map((row, i) => {
        if (!touched.has(i)) return row
        const next = row.slice()
        for (const e of edits) if (e.rowIndex === i) next[e.colIndex] = e.value
        return next
      })
      return { ...t, result: { ...t.result, rows } }
    })
  })),
```
Add the type to the store interface: `applyResultEdits: (tabId: string, edits: { rowIndex: number; colIndex: number; value: unknown }[]) => void`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "feat: applyResultEdits store action"
```

---

### Task 11: ResultsGrid inline editing + dirty highlight + commit/discard

**Files:**
- Modify: `src/renderer/src/components/ResultsGrid.tsx`
- Modify: `src/renderer/src/components/ResultsPanel.tsx` (pass props)
- Modify: `src/renderer/src/styles.css` (`.cell-dirty`, commit bar)

- [ ] **Step 1: Pass editing context from ResultsPanel to ResultsGrid**

In `ResultsPanel.tsx`, look up the connection (use `useConnections()` like `QueryTab` does, find by `tab.connectionId`) and pass to `<ResultsGrid>`: `connectionId={tab.connectionId}`, `editable={result.editable}`, `readOnly={connection?.readOnly ?? true}`, `requireCommit={connection?.requireCommit ?? true}`. (Read-only or unknown connection → no editing.)

- [ ] **Step 2: Extend ResultsGrid props + dirty state**

In `ResultsGrid.tsx`, extend `Props`:
```ts
interface Props {
  columns: ColumnMeta[]
  rows: unknown[][]
  globalFilter: string
  connectionId?: string
  editable?: EditableResult | null
  readOnly?: boolean
  requireCommit?: boolean
}
```
Add state mirroring the selection's rows-reference invalidation:
```ts
const [dirty, setDirty] = useState<Map<string, unknown>>(new Map())
if (dirtyRowsRef.current !== rows) { /* reset on new result */ }
```
Use a ref to track the rows reference the dirty map belongs to; when `rows` changes, clear `dirty` (render-phase reset, same pattern as `sel`). Also `const [editing, setEditing] = useState<{ rowIndex: number; colIndex: number } | null>(null)`.

- [ ] **Step 3: Make a cell editable + render the editor / dirty value**

A column index `col` is editable when `!readOnly && editable && editable.columnSources[col] !== null && !editable.keyColumns.includes(editable.columnSources[col]!)`. In the cell render:
- Replace the cell's `onDoubleClick={() => void window.api.clipboard.copy(text)}` with: if the cell is editable → `setEditing({ rowIndex: Number(row.id), colIndex })`; else keep the copy behavior.
- When `editing` points at this cell, render an `<input>` (autoFocus) seeded with the current value (dirty value if present else raw); Enter commits to staging via `commitCell`, Escape cancels (`setEditing(null)`); a small "NULL" button sets null. `onBlur` commits too.
- When a dirty value exists for this cell (`dirty.has(dirtyKey(rowIndex, colIndex))`), render the new value with `className="grid-cell cell-dirty"`.

`commitCell(rowIndex, colIndex, value)`:
```ts
const next = new Map(dirty); next.set(dirtyKey(rowIndex, colIndex), value); setDirty(next); setEditing(null)
if (!requireCommit) void commit(next)   // fast-commit mode: write immediately
```

- [ ] **Step 4: Commit / discard**

```ts
async function commit(map = dirty): Promise<void> {
  if (!editable || !connectionId || map.size === 0) return
  const rowEdits = buildRowEdits(map, rows, editable)
  try {
    await window.api.edits.apply({ connectionId, table: editable.table, rows: rowEdits }).then(unwrap)
    // reflect committed values into the store result, then clear the dirty map
    const applied = [...map].map(([k, value]) => { const [rowIndex, colIndex] = k.split(':').map(Number); return { rowIndex, colIndex, value } })
    useAppStore.getState().applyResultEdits(activeTabId, applied)   // see note
    setDirty(new Map())
    setEditError(null)
  } catch (e) {
    setEditError(e instanceof Error ? e.message : String(e))  // leave dirty map intact
  }
}
```
Note: ResultsGrid doesn't currently know its tab id. Pass `tabId` from ResultsPanel (`tab.id`) as a prop, or call `applyResultEdits` from ResultsPanel via a callback. Simplest: add a `tabId` prop. Render a commit bar when `requireCommit && dirty.size > 0`:
```tsx
{requireCommit && dirty.size > 0 && (
  <div className="edit-bar">
    <span>{dirty.size} pending change{dirty.size > 1 ? 's' : ''}</span>
    <button className="btn primary" onClick={() => void commit()}>Commit</button>
    <button className="btn" onClick={() => setDirty(new Map())}>Discard</button>
    {editError && <span className="edit-error" role="alert">{editError}</span>}
  </div>
)}
```

- [ ] **Step 5: Styles**

In `styles.css` add (use existing theme vars):
```css
.cell-dirty { background: var(--warn-border); box-shadow: inset 2px 0 0 var(--warn); }
.edit-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--border); background: var(--bg-2); font-size: 12px; }
.edit-error { color: var(--danger-text); }
.grid-cell input { width: 100%; height: 100%; border: 1px solid var(--accent); background: var(--bg); color: var(--text); font: inherit; padding: 0 6px; }
```

- [ ] **Step 6: Typecheck, lint, full unit suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 7: Live-verify in the dev app**

Restart dev (`nohup npm run dev …`). With a Postgres/MySQL connection: run `SELECT * FROM <table-with-PK>`; double-click a non-PK cell → edit; with `requireCommit` ON the cell highlights and the commit bar appears → Commit writes it (re-run to confirm persisted); with `requireCommit` OFF, Enter writes immediately. A join/expression result shows no editor (copy still works). A read-only connection shows no editor.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ResultsGrid.tsx src/renderer/src/components/ResultsPanel.tsx src/renderer/src/styles.css
git commit -m "feat: editable result cells — inline edit, dirty highlight, commit/discard"
```

---

### Task 12: README + final gates

- [ ] **Step 1: README**

Add a feature bullet to `README.md` (near the Results bullet): editable cells (double-click) for single-table results with a primary key, pending-edit highlight, and the per-connection "require explicit commit" safety. Bump the unit-test count on the `npm test` line.

- [ ] **Step 2: Full gates + integration**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run test:integration`
Expected: all green (integration needs Docker; covers pg + mysql applyEdits).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — editable SQL results (Phase A)"
```

---

## Self-Review notes

- **Spec coverage (Phase A):** requireCommit setting → Tasks 1–2; `EditableResult` → Task 3; pg/mysql descriptor derivation → Tasks 4,6,7; `edits.apply` + driver applyEdits + read-only refusal + exactly-1-row → Tasks 6,7,8; staging/dirty/commit/fast-vs-safe UX → Tasks 9,10,11; highlight → Task 11; tests → each task + Task 12 integration. Mongo (phase B), insert/delete, ScriptResults editing, inspector editing are explicitly out of Phase A.
- **Type consistency:** `EditableResult`/`RowEdit` (shared/query.ts) used identically in `edit-target.ts`, `update-builder.ts`, driver `applyEdits`, `edits.apply` IPC, and `edit-staging.ts`. `buildUpdate(dialect, table, edit)`, `buildEditableResult(perColumn, pkColumns)`, `buildRowEdits(dirty, rows, editable)`, `dirtyKey(rowIndex, colIndex)`, `applyResultEdits(tabId, edits)` are referenced with the same signatures throughout.
- **Open detail to resolve during impl:** the exact mysql2 pool-options spot for `foundRows: true` (Task 7 Step 4) and the store test arrangement (Task 10) depend on the current file shapes — both call out a grep/inspect step first.
