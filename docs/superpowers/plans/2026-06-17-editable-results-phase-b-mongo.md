# Editable query results — Phase B (MongoDB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the editable-results feature (Phase A: SQL) to MongoDB — double-click a cell in a `find`/`findOne` result to edit it, committed via `updateOne` by `_id`, reusing the same staging / per-cell-reset / ⌘S-review-modal UX.

**Architecture:** A Mongo result reports `editable` when it's a `find`/`findOne` over one collection whose documents carry `_id` (the key). `applyEdits` does `updateOne({_id}, {$set})` per staged row (EJSON-deserialized so `_id`/dates/ObjectIds round-trip). Because Mongo needs *typed* values (`$set: {n: "42"}` would store a string), the renderer coerces the edited text to a value using the original cell's type before staging — for Mongo connections only. Pure logic (`mongoEditable`, `coerceMongoEditValue`) is unit-tested; the apply path is integration-tested against real Mongo.

**Tech Stack:** TypeScript, `mongodb` + `bson` (EJSON), React, Vitest + `@testcontainers/mongodb`.

**Scope (Phase B):** `find`/`findOne` results only (aggregate can reshape documents → not editable, like a SQL join). Top-level fields; `_id` is read-only (the key). No insert/delete. Sequential `updateOne` (no multi-doc transaction on standalone mongod) — `$set` is idempotent so a retry after a partial failure is safe.

---

### Task 1: Pure `mongoEditable` descriptor

**Files:**
- Create: `src/main/drivers/mongo/edit-target.ts`
- Test: `src/main/drivers/mongo/edit-target.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { ColumnMeta } from '../../../shared/query'
import { mongoEditable } from './edit-target'

const cols = (...names: string[]): ColumnMeta[] => names.map((name) => ({ name, dataType: null }))
const T = { schema: 'shop', name: 'users' }

describe('mongoEditable', () => {
  it('is editable when _id is present; every top-level field maps to itself, _id is the key', () => {
    expect(mongoEditable(cols('_id', 'name', 'age'), T)).toEqual({
      table: T,
      keyColumns: ['_id'],
      columnSources: ['_id', 'name', 'age']
    })
  })
  it('is null when _id is absent (e.g. projected away — can not target the document)', () => {
    expect(mongoEditable(cols('name', 'age'), T)).toBeNull()
  })
  it('is null for an empty column set', () => {
    expect(mongoEditable(cols(), T)).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/main/drivers/mongo/edit-target.test.ts`) — module not found.

- [ ] **Step 3: Implement**

```ts
import type { ColumnMeta, EditableResult } from '../../../shared/query'

/** Editable descriptor for a Mongo find/findOne result over one collection: every
 *  top-level field is editable, keyed by `_id`. Null when `_id` is not in the result
 *  (no way to target the document). */
export function mongoEditable(columns: ColumnMeta[], table: { schema: string | null; name: string }): EditableResult | null {
  const names = columns.map((c) => c.name)
  if (!names.includes('_id')) return null
  return { table, keyColumns: ['_id'], columnSources: names }
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/mongo/edit-target.ts src/main/drivers/mongo/edit-target.test.ts
git commit -m "feat: pure mongoEditable descriptor (find result, keyed by _id)"
```

---

### Task 2: Wire the descriptor into `normalizeFind` (find/findOne only)

**Files:**
- Modify: `src/main/drivers/mongo/normalize.ts`
- Modify: `src/main/drivers/mongo/mongo.ts`

- [ ] **Step 1: Add an optional edit table to `normalizeFind`**

In `normalize.ts`, import `mongoEditable` and change the signature so callers that are a single-collection real-document read pass the table; others don't:

```ts
import { mongoEditable } from './edit-target'
// …
export function normalizeFind(
  docs: unknown[],
  maxRows: number,
  durationMs: number,
  editTable?: { schema: string | null; name: string }
): QueryResult {
  // …existing body that builds `columns`/`rows`/`capped`…
  return {
    columns, rows, rowCount: capped.length, durationMs, truncated, documents: capped,
    editable: editTable ? mongoEditable(columns, editTable) : null
  }
}
```

- [ ] **Step 2: Pass the resolved db+collection for find/findOne in `mongo.ts` runQuery**

In `mongo.ts` `runQuery`, the effective database is `cmd.database ?? database`. Build it once and pass it as the edit table for `find` and `findOne` only (NOT `aggregate` — it can reshape documents):

```ts
const editTable = { schema: cmd.database ?? database ?? null, name: cmd.collection }
// case 'find':
return normalizeFind(await cursor.toArray(), opts.maxRows, ms(), editTable)
// case 'findOne':
return normalizeFind(doc ? [doc] : [], opts.maxRows, ms(), editTable)
// case 'aggregate': (unchanged — no editTable)
return normalizeFind(await coll.aggregate(...).toArray(), opts.maxRows, ms())
```

(Build `editTable` after the no-default-database guard, so a db is always present when it's used.)

- [ ] **Step 3: Typecheck + existing mongo unit tests**

Run: `npm run typecheck && npx vitest run src/main/drivers/mongo`
Expected: clean / green (the existing normalize tests pass `editTable` undefined → `editable: null`, unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/main/drivers/mongo/normalize.ts src/main/drivers/mongo/mongo.ts
git commit -m "feat: mongo find/findOne results report an editable descriptor"
```

---

### Task 3: `applyEdits` on the Mongo driver

**Files:**
- Modify: `src/main/drivers/mongo/mongo.ts`
- Test: `src/main/drivers/mongo/mongo.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add to `mongo.integration.test.ts` (mirror its existing setup — a started `MongoDBContainer`, `driver.connect`, an `id`, seeding via `runQuery` insert):

```ts
it('applyEdits updates a document by _id and preserves value types', async () => {
  await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertMany', collection: 'edit_c', documents: [{ _id: 1, name: 'a', age: 30 }, { _id: 2, name: 'b', age: 40 }] } }, { maxRows: 100, queryId: 'i1', readOnly: false })
  const sel = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_c', filter: {} } }, { maxRows: 100, queryId: 'i2', readOnly: false })
  expect(sel.editable).toEqual({ table: { schema: container.getDatabase ? expect.anything() : undefined, name: 'edit_c' }, keyColumns: ['_id'], columnSources: expect.arrayContaining(['_id', 'name', 'age']) })

  const r = await driver.applyEdits(id, { table: { schema: sel.editable!.table.schema, name: 'edit_c' }, rows: [{ key: { _id: 1 }, set: { name: 'AA', age: 31 } }] }, { readOnly: false })
  expect(r.updated).toBe(1)
  const after = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_c', filter: { _id: 1 } } }, { maxRows: 10, queryId: 'i3', readOnly: false })
  const doc = after.documents![0]
  expect(doc.name).toBe('AA')
  expect(doc.age).toBe(31) // stayed a number, not "31"
})

it('applyEdits round-trips an ObjectId _id', async () => {
  await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertOne', collection: 'edit_oid', document: { tag: 'x' } } }, { maxRows: 10, queryId: 'o1', readOnly: false })
  const sel = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_oid', filter: {} } }, { maxRows: 10, queryId: 'o2', readOnly: false })
  const idCol = sel.columns.findIndex((c) => c.name === '_id')
  const oid = sel.rows[0][idCol] // EJSON { $oid: "…" }
  const r = await driver.applyEdits(id, { table: { schema: sel.editable!.table.schema, name: 'edit_oid' }, rows: [{ key: { _id: oid }, set: { tag: 'y' } }] }, { readOnly: false })
  expect(r.updated).toBe(1)
})

it('applyEdits refuses on read-only and throws when the document is gone', async () => {
  await expect(driver.applyEdits(id, { table: { schema: sel0Schema, name: 'edit_c' }, rows: [{ key: { _id: 1 }, set: { name: 'z' } }] }, { readOnly: true })).rejects.toThrow(/read-only/i)
  await expect(driver.applyEdits(id, { table: { schema: sel0Schema, name: 'edit_c' }, rows: [{ key: { _id: 9999 }, set: { name: 'z' } }] }, { readOnly: false })).rejects.toThrow(/matched 0|expected exactly one/i)
})
```

(Use the real resolved schema from a prior `sel.editable!.table.schema`; store it in a variable. Adjust the `editable` assertion to the container's actual default db name — read `sel.editable!.table.schema` rather than hard-coding.)

- [ ] **Step 2: Run — expect FAIL** (`applyEdits` throws "not supported yet").

- [ ] **Step 3: Implement `applyEdits` in `mongo.ts`**

Replace the Phase-A stub. Import `EJSON` from `bson` (already used in normalize.ts) and `TableEdits` type:

```ts
async applyEdits(id: string, edits: TableEdits, opts: { readOnly: boolean }): Promise<{ updated: number }> {
  if (opts.readOnly) throw new Error('Connection is read-only: edits are blocked')
  const { client } = this.require(id)
  if (!edits.table.schema) throw new Error('No database for the edit target')
  const coll = client.db(edits.table.schema).collection(edits.table.name)
  let updated = 0
  for (const row of edits.rows) {
    // EJSON round-trip: the _id comes back as { $oid: … }/scalar from the result, and a
    // user-edited value may be an EJSON wrapper too — deserialize both to real BSON.
    const filter = EJSON.deserialize(row.key) as Filter<Document>
    const update = { $set: EJSON.deserialize(row.set) as Document }
    const res = await coll.updateOne(filter, update)
    if (res.matchedCount !== 1) {
      throw new Error(`Edit matched ${res.matchedCount} documents (expected exactly one) — the document may have changed; refresh and retry`)
    }
    updated += res.matchedCount
  }
  return { updated }
}
```

Add `TableEdits` to the `../types` import. Note (documented limitation): Mongo applies edits sequentially without a multi-document transaction (standalone mongod doesn't support them); `$set` is idempotent, so re-committing after a partial failure safely re-applies.

- [ ] **Step 4: Run the integration test** (`npx vitest run src/main/drivers/mongo/mongo.integration.test.ts --config vitest.integration.config.ts`) — expect PASS (needs Docker).

- [ ] **Step 5: Commit**

```bash
git add src/main/drivers/mongo/mongo.ts src/main/drivers/mongo/mongo.integration.test.ts
git commit -m "feat: mongo applyEdits — updateOne by _id, EJSON round-trip, read-only refused"
```

---

### Task 4: Renderer value coercion for Mongo

**Files:**
- Create: `src/renderer/src/lib/mongo-edit-value.ts`
- Test: `src/renderer/src/lib/mongo-edit-value.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { coerceMongoEditValue } from './mongo-edit-value'

describe('coerceMongoEditValue', () => {
  it('keeps a string-typed field a string (no accidental number coercion)', () => {
    expect(coerceMongoEditValue('42', 'old')).toBe('42')
  })
  it('parses a number-typed field back to a number', () => {
    expect(coerceMongoEditValue('43', 7)).toBe(43)
  })
  it('parses a boolean-typed field', () => {
    expect(coerceMongoEditValue('false', true)).toBe(false)
  })
  it('parses an object/array (the editor shows JSON) back to a value', () => {
    expect(coerceMongoEditValue('{"a":1}', { a: 0 })).toEqual({ a: 1 })
  })
  it('falls back to the raw string when a non-string field gets unparseable text', () => {
    expect(coerceMongoEditValue('hello', 5)).toBe('hello')
  })
  it('passes null through (the NULL control)', () => {
    expect(coerceMongoEditValue(null, 5)).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
/** Convert the editor's text into a typed value for a Mongo $set, biased by the original
 *  cell value's type so a string field stays a string ("42" → "42", not 42). For any
 *  other type the text is JSON-parsed (numbers, booleans, null, objects/arrays — the
 *  editor shows objects as JSON), falling back to the raw string when it won't parse.
 *  null (the NULL control) passes through. The driver then EJSON-deserializes, so an
 *  edited `{ "$oid": "…" }` round-trips to an ObjectId. */
export function coerceMongoEditValue(text: string | null, original: unknown): unknown {
  if (text === null) return null
  if (typeof original === 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/mongo-edit-value.ts src/renderer/src/lib/mongo-edit-value.test.ts
git commit -m "feat: coerceMongoEditValue — typed values for mongo $set"
```

---

### Task 5: Apply the coercion in ResultsGrid for Mongo connections

**Files:**
- Modify: `src/renderer/src/components/ResultsPanel.tsx` (pass the engine)
- Modify: `src/renderer/src/components/ResultsGrid.tsx`

- [ ] **Step 1: Pass an `isMongo` flag from ResultsPanel**

In `ResultsPanel.tsx`, add to the `<ResultsGrid>` props: `isMongo={connection?.type === 'mongodb'}`.

- [ ] **Step 2: Coerce in `stageCell`**

In `ResultsGrid.tsx`, add `isMongo?: boolean` to `Props` and destructure it. Import the helper: `import { coerceMongoEditValue } from '../lib/mongo-edit-value'`. In `stageCell`, coerce the staged value for Mongo using the cell's original value:

```ts
function stageCell(rowIndex: number, colIndex: number, value: unknown): void {
  if (!tabId) return
  const stored = isMongo ? coerceMongoEditValue(value as string | null, rows[rowIndex][colIndex]) : value
  store().setCellEdit(tabId, dirtyKey(rowIndex, colIndex), stored)
  setEditing(null)
  if (!requireCommit) void store().commitEdits(tabId)
}
```

(`value` from `EditingCell` is the typed text or `null` from the NULL control; SQL keeps the string as before.)

- [ ] **Step 3: Typecheck + lint + full unit suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 4: Live-verify (dev app, Mongo connection)**

Run a `db.<collection>.find({})`. Double-click a non-`_id` cell → edit; with require-commit ON, ⌘S opens the review modal → Confirm writes. Re-run to confirm: a numeric field stays numeric, a string stays string, `_id` is not editable, an `aggregate` result shows no editor, a read-only connection shows no editor.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ResultsPanel.tsx src/renderer/src/components/ResultsGrid.tsx
git commit -m "feat: coerce mongo cell edits to typed values before staging"
```

---

### Task 6: README + final gates

- [ ] **Step 1: README** — in the "Edit results in place" bullet, drop "(MongoDB editing is coming next.)" and note Mongo is supported (find results, `updateOne` by `_id`). Bump the unit-test count.

- [ ] **Step 2: Full gates + integration**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run test:integration`
Expected: all green (integration covers mongo applyEdits + SQL, needs Docker).

- [ ] **Step 3: Commit** the README.

---

## Self-Review notes

- **Spec coverage (Phase B):** Mongo descriptor (Tasks 1–2), `updateOne`-by-`_id` apply + read-only refusal + exactly-one-match (Task 3), value typing from the original (Tasks 4–5). Reuses Phase A's IPC (`edits.apply`), staging, commit modal, per-cell reset — no changes there.
- **Type consistency:** `mongoEditable(columns, table)` and `coerceMongoEditValue(text, original)` referenced identically; `applyEdits(id, TableEdits, {readOnly})` matches the `DatabaseDriver` interface; `EditableResult`/`RowEdit` unchanged.
- **Safety decisions (documented):** find/findOne only (aggregate excluded); `_id` read-only; sequential `updateOne` without a transaction (idempotent `$set` → safe retry); EJSON deserialize for `_id`/ObjectId/date round-trips; read-only refused at UI+IPC+driver.
- **Out of scope (deferred):** insert/delete documents, nested-field path editing, editing aggregate results, multi-document transactions.
