# Editable query results — design

## Problem

The results grid is read-only. The user wants to **edit cell values in place by
double-clicking**, see **changed cells highlighted in a distinct color** before they
are written, and a **per-connection setting that prevents "fast commit"** — i.e.
holds edits until an explicit commit instead of writing immediately.

## Decisions (from brainstorming)

- **Engines:** all four — Postgres, MySQL/MariaDB (UPDATE by primary key) and MongoDB
  (`updateOne` by `_id`). Built in two phases under one spec: (A) connection setting +
  SQL editing + the full staging/commit UX, then (B) Mongo editing reusing that UX.
- **Commit setting:** a per-connection boolean **`requireCommit`** (default **true** =
  safer). ON → edits stage as highlighted pending changes and are written only on an
  explicit **Commit** (one transaction). OFF → committing a cell (Enter) writes it
  immediately. **Read-only connections disable editing entirely**, regardless.
- **Editable scope:** only a result that maps to a **single base table/collection with
  a row key present in the result** is editable; everything else (joins, expressions,
  aggregates, PK-less or multi-table results) stays read-only. This is an expandable
  seam — more strategies can be added later without changing the UX.
- **v1 limits:** edit existing cell values only — **no insert/delete rows** (future).
  PK / `_id` cells are read-only (keeps the row key stable). Mongo edits target
  **top-level scalar fields** only (nested/document-tree editing is future).

## Architecture

Pure-logic / thin-wiring split, mirroring the rest of the codebase.

### 1. The editable descriptor (`src/shared/query.ts`)

`QueryResult` gains one optional field:

```ts
export interface EditableResult {
  table: { schema: string | null; name: string }
  /** Real base-table columns that form the row key (SQL primary key, or ['_id']). */
  keyColumns: string[]
  /** Per result-column index: the real base-table column it maps to, or null for an
   *  expression / joined / computed column. A column is editable when this is non-null
   *  and not in keyColumns. */
  columnSources: (string | null)[]
}
export interface QueryResult {
  /* …existing… */
  /** Present only when the result maps to one editable table/collection with its key
   *  present, AND the connection is not read-only. null = the grid is read-only. */
  editable: EditableResult | null
}
```

Every keyColumn must appear in `columnSources` (else the row can't be targeted → not
editable). The renderer reads a row's key values by finding, for each keyColumn, the
result-column index where `columnSources[i] === keyColumn`.

### 2. Deriving the descriptor in each driver

Computed inside `runQuery` from metadata the drivers already receive; the per-table key
lookup is cached per `(connectionId, table)`.

- **Postgres** (`postgres.ts`): `res.fields[i]` carries `tableID` (oid) and `columnID`
  (attnum). If exactly one distinct non-zero `tableID` spans the value columns, resolve
  that table once via a cached query over `pg_class`/`pg_namespace`/`pg_attribute`/
  `pg_index` → `{ schema, name, attnum→attname, pkColumns }`. `columnSources[i]` =
  attname for `fields[i].columnID` when its `tableID` matches, else null.
  `keyColumns` = the PK attnames. Null descriptor if 0 or >1 source tables, no PK, or
  any PK column is absent from the result.
- **MySQL/MariaDB** (`mysql.ts`): field packets carry `orgTable`, `orgName`, `db`. If
  all value columns share one non-empty `(db, orgTable)`, that's the table;
  `columnSources[i]` = `orgName` (else null). `keyColumns` = PK via cached
  `information_schema.KEY_COLUMN_USAGE`/`SHOW KEYS … WHERE Key_name='PRIMARY'`.
- **MongoDB** (`mongo.ts`, phase B): a `find`/`aggregate` over one collection. The
  collection is the table; `keyColumns = ['_id']`. `columnSources[i]` = the column name
  when it is a top-level field present on the documents and not a dotted/nested path,
  else null. Null descriptor when `_id` is projected away or the command isn't a single
  read over one collection.

A pure helper per shape (`singleSourceTable(fields)`) is unit-tested; the cached key
lookup is a small DB query verified by integration tests.

### 3. Apply path — IPC + driver

A dedicated channel so the renderer never builds SQL/commands.

```ts
// src/shared/ipc.ts
'edits.apply': {
  req: { connectionId: string; table: { schema: string | null; name: string }; rows: RowEdit[] }
  res: { updated: number }
}
// shared types
export interface RowEdit {
  key: Record<string, unknown>  // keyColumn → original value (the WHERE)
  set: Record<string, unknown>  // realColumn → new value (the SET)
}
```

`DatabaseDriver` gains `applyEdits(id, edits, opts: { readOnly: boolean }): Promise<{ updated: number }>`:

- **SQL:** in **one transaction**, per row `UPDATE <qualified table> SET <set…> WHERE
  <key…>` fully **parameterized** (no string interpolation of values; identifiers quoted
  per dialect — pg `"…"`, mysql `` `…` ``). Each statement must affect **exactly one
  row**, else **roll back the whole batch** and throw (a row changed/removed underneath,
  or an ambiguous key). Returns the number updated.
- **Mongo (phase B):** per row `updateOne({ _id }, { $set })`; refused on read-only.

The IPC handler loads the connection config and **throws if `config.readOnly`** before
touching the driver; the driver also refuses when `opts.readOnly` (defense in depth),
mirroring how `runQuery` carries the read-only flag. Value typing: SQL binds the value
as a parameter and lets the server coerce to the column type; an explicit `null` sets
NULL. Mongo infers scalar type from the original value.

The pure **statement builder** (`update-builder.ts`: RowEdit + dialect → `{ sql, params }`)
and the Mongo command builder are unit-tested for quoting, binding, NULL, and multi-key
WHERE.

### 4. Connection setting (`requireCommit`)

- `ConnectionInput` gains `requireCommit: boolean` (so `ConnectionConfig` too).
- Persistence: a `require_commit` INTEGER column added to the `connections` table via the
  existing idempotent `addColumnIfMissing` migration (default `1`); create/update/read
  mappers in `persistence/connections.ts` carry it.
- `ConnectionModal` gains a checkbox: **"Require explicit commit for cell edits (prevent
  fast commit)"**, with a one-line hint. Disabled/irrelevant when **Read-only** is on.

### 5. Renderer — editing UX

- `QueryTab`/`ResultsPanel` pass the active connection's `readOnly` + `requireCommit`,
  the `connectionId`, and `result.editable` down to `ResultsGrid`. **Editing is the
  primary `ResultsGrid` only** — `ScriptResults` (multi-statement runs) stays read-only
  in v1.
- **Dirty model** (`lib/edit-staging.ts`, pure, unit-tested): a map keyed by
  `rowId:colIndex` (TanStack row id = original data index, so edits survive sort/filter)
  holding the new value; it self-invalidates when the `rows` reference changes (new
  result), like the inspector selection. A builder turns the dirty map + the result +
  `editable` into a `RowEdit[]` (grouping cells by row, reading each row's key values).
- **Cell interaction:** a cell is editable when `editable` is present, its
  `columnSources[col]` is non-null and not a key column, and the connection isn't
  read-only. **Double-click an editable cell → inline `<input>` over it**; Enter keeps
  the edit, Esc cancels; a small **"NULL"** control sets null. Double-click a
  non-editable cell still **copies**, as today. A dirty cell renders with a distinct
  **`.cell-dirty`** color showing the new value.
- **Commit/discard:**
  - `requireCommit` **ON** → a bar appears while there are pending edits: *"N pending
    changes — [Commit] [Discard]"*. Commit calls `edits.apply` with all rows; Discard
    clears the dirty map.
  - `requireCommit` **OFF** → Enter on a cell applies that single edit immediately
    (still shows the brief dirty→saved transition).
  - On success: a store action rewrites the affected cells in the tab's `result.rows`
    (immutable update) and the dirty entries clear. On failure: edits stay pending and
    the error surfaces (reusing the existing query-error surface).
- **Highlight:** `.cell-dirty` (e.g. amber background + left accent) in both themes.

## Out of scope (v1)

- Inserting or deleting rows.
- Editing PK / `_id` cells, nested/array Mongo fields, or editing inside `ScriptResults`.
- Editing from the Row Inspector (a natural future home for long/JSON values).
- Optimistic-concurrency beyond the exactly-1-row guard (no row-version checks).

## Testing

- **Unit (pure):** `singleSourceTable` derivation per metadata shape; `update-builder`
  (pg/mysql quoting, param binding, NULL, composite key); the Mongo command builder;
  `edit-staging` (dirty map keying/survival/invalidation, RowEdit assembly, key-value
  reading); the connection-mapper round-trip for `requireCommit`.
- **Integration (Docker):** pg + mysql `applyEdits` — a real UPDATE by PK, the
  exactly-1-row rollback on a stale key, composite-PK update, and **read-only refusal**;
  mongo `updateOne` by `_id` (phase B).
- **Live:** double-click edit, dirty highlight, Commit/Discard in both setting modes,
  read-only connection shows no editing, value adopted after commit — verified in the
  dev app (CDP if needed).

## Phasing

- **Phase A:** `requireCommit` setting (domain + migration + modal) · `EditableResult`
  on `QueryResult` · pg + mysql descriptor derivation · `edits.apply` IPC + SQL
  `applyEdits` · the full renderer editing/staging/commit UX. Ships complete SQL editing.
- **Phase B:** Mongo descriptor derivation + `updateOne` apply, wired into the same UX.
