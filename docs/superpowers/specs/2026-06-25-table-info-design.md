# Table info — indexes, foreign keys, constraints & size — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming)
**Branch:** new `feat/table-info` off `main`.

## Goal

Let the user open a **"Table info" tab** for any table/collection showing its structure:
detailed **columns**, **indexes**, **foreign keys** (out + incoming), **constraints**
(unique/check), and an approximate **size** (row estimate + bytes). Works for Postgres,
MySQL/MariaDB, and MongoDB (with the sections an engine doesn't have shown empty).

## Approach

One bundled driver method `describeTableInfo(id, ref): Promise<TableInfo>` (one IPC
round-trip; the tab shows every section, so fetch it all upfront). The view is a new tab
kind (like the schema diagram), opened from the object tree.

## Data model — `src/shared/schema.ts`

```ts
export interface ColumnDetail extends ColumnInfo {   // ColumnInfo = { name; dataType; nullable }
  default: string | null
  primaryKey: boolean
}
export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  method: string | null            // pg: btree/gin/…; mysql: BTREE/…; mongo: null / '2dsphere' / 'text'
}
export interface ForeignKeyInfo {
  name: string | null
  columns: string[]                // local columns, in key order
  refSchema: string | null
  refTable: string
  refColumns: string[]             // referenced columns, index-aligned with `columns`
}
export interface ConstraintInfo {
  name: string
  type: 'unique' | 'check'
  detail: string                   // unique: "(a, b)"; check: the expression
}
export interface TableSize { rowEstimate: number | null; bytes: number | null }
export interface TableInfo {
  ref: ObjectRef
  columns: ColumnDetail[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]    // outgoing (this table → others)
  referencedBy: ForeignKeyInfo[]   // incoming (others → this table)
  constraints: ConstraintInfo[]    // unique + check (PK/FK have their own sections)
  size: TableSize | null
}
```

## Pure helpers — `src/main/drivers/sql/table-info-shape.ts` (unit-tested)

Flat per-column rows from the catalog get folded into the grouped shapes — the same
composite-key concern as `listRelationships`:

```ts
// rows ordered by (indexName, ordinal): one IndexInfo per name, columns in order
groupIndexes(rows: { name; column; unique; primary; method; ord }[]): IndexInfo[]
// rows ordered by (constraintName, ordinal): one ForeignKeyInfo per name
groupForeignKeys(rows: { name; column; refSchema; refTable; refColumn; ord }[]): ForeignKeyInfo[]
```

## Per-engine `describeTableInfo`

- **Postgres** (`postgres.ts`): columns + `column_default` + PK (from `information_schema` /
  `pg_constraint`); indexes from `pg_index`+`pg_class`+`pg_am` with `unnest(indkey) WITH
  ORDINALITY` (name, cols-in-order, unique, primary, `amname` method); FKs from
  `pg_constraint` (`unnest(conkey, confkey) WITH ORDINALITY`, grouped by `conname`) for both
  directions; constraints from `pg_constraint` (`contype IN ('u','c')`, detail via
  `pg_get_constraintdef`); size via `pg_total_relation_size(regclass)` + `pg_class.reltuples`.
- **MySQL/MariaDB** (`mysql.ts`): `information_schema.COLUMNS` (incl. `COLUMN_DEFAULT`,
  `COLUMN_KEY='PRI'`); `STATISTICS` (indexes, `NON_UNIQUE`, `SEQ_IN_INDEX`, `INDEX_TYPE`);
  `KEY_COLUMN_USAGE` (FKs both directions, grouped by `CONSTRAINT_NAME`); `CHECK_CONSTRAINTS`
  joined to `TABLE_CONSTRAINTS` for checks (**best-effort** — wrap in try/catch; absent on
  MySQL < 8.0.16 / older MariaDB → empty); `TABLES` (`TABLE_ROWS`, `DATA_LENGTH+INDEX_LENGTH`).
  Single-database scope: `refSchema`/`schema` stay null, matching `listObjects`/`listRelationships`.
- **MongoDB** (`mongo.ts`): "columns" = the sampled/inferred fields (reuse the existing
  `describeObject` sampling) with `_id` flagged `primaryKey`, `default` null; `listIndexes` →
  `IndexInfo` (name, key fields in order, `unique`, `primary` = the `_id_` index, method from a
  non-1/-1 key value else null); `collStats` → size (`count`, `size`/`storageSize` bytes).
  `foreignKeys`/`referencedBy`/`constraints` empty.

## Wiring

- **IPC**: `schema.tableInfo: { req: { connectionId: string; ref: ObjectRef }; res: TableInfo }`
  (+ the `DriverManager`/handler glue mirroring `schema.columns`).
- **Store**: `QueryTabData` gains `'table-info'` to its `kind` union and an optional
  `objectRef?: ObjectRef` (which table this info tab targets; `blankTab` carries it). New
  action `openTableInfoTab(connectionId, ref)` — opens or focuses (one info tab per
  connection+table, deduped on `kind==='table-info' && objectRef` match), targets the focused
  pane, title `▤ <name> · info`. Works with split views (it's just another tab kind).
  Session persistence skips it (ephemeral, like the diagram tab — `toSessionTabs` already drops
  non-`undefined`/non-query kinds; confirm `'table-info'` is excluded too).
- **UI**: `TableInfoView` (a `useTableInfo(connectionId, ref)` TanStack Query hook fetches
  `TableInfo`) renders the sections as titled tables; empty sections show "None" / are hidden
  (Mongo's FK/constraint sections). `EditorPane` renders it when `tab.kind === 'table-info'`
  (alongside the existing diagram/query branches).
- **Trigger**: the object tree gains a right-click context menu on a table row → **"Table
  info"** (double-click still runs the SELECT). A reusable small menu component (the tab bar's
  `TabContextMenu` pattern). Optional ⌘K entry is a follow-up.

## Implementation slices

- **Slice A** — `ColumnDetail`/`IndexInfo`/`ForeignKeyInfo` + the `groupIndexes`/
  `groupForeignKeys` helpers + `describeTableInfo` (columns/indexes/FKs only, size/constraints
  null/empty) on all 3 engines + IPC + tab kind + `openTableInfoTab` + `TableInfoView` +
  trigger. Lands a working Columns/Indexes/Foreign keys tab.
- **Slice B** — add `constraints` + `size` to the data model, the per-engine queries, and two
  more sections in the view.

## Testing

- **Unit**: `groupIndexes`/`groupForeignKeys` (composite columns in order; unique/primary
  flags; multiple indexes/FKs; empty input).
- **Integration** (real containers, mirroring the `listRelationships` tests): create a table
  with a PK, an FK (incl. composite), a unique index, a column default, (slice B) a CHECK
  constraint and some rows → call `describeTableInfo` → assert each section. Mongo: a
  collection with a compound + unique index → assert indexes + `_id` PK + size count.
- The `TableInfoView` UI is manually verified (no RTL).

Branch `feat/table-info`; merge + push are the user's call at the end (per standing pref,
unless they ask me to).
