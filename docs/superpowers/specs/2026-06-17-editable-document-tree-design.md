# Editable JSON document tree (nested) — design

## Problem

The results JSON/document view (`DocumentView`, shown for Mongo results) is read-only.
Editing was built only into the table grid, which reaches **top-level** fields. Users
want to edit **nested** values directly in the tree (`address.city`, `tags.0`) — the
tree's whole point, and something the flat table can't do.

## Decisions (from brainstorming)

- **Scope: nested scalar leaves at any depth**, including array elements. Object/array
  *containers* are edited via their leaves, not as a whole. `_id` is read-only (the key).
  EJSON wrapper values (`{$oid}`, `{$date}`, `{$numberLong}`, …) are treated as whole
  scalar values — never drilled into for editing. Mongo only (the tree is Mongo-only).
- **Unify staging on field PATHS.** The staged-edit key changes from `row:columnIndex`
  to `row:fieldPath`. A table cell's path is its column/field name; a tree leaf's path is
  its dotted path. Table and tree thus share one staged change per field — editing a
  top-level field in either view is the same edit. SQL is unaffected: its paths are
  always flat column names (no dots).
- **Commit unchanged in shape.** `updateOne({_id}, {$set: {"<path>": value}})` per
  document (Mongo); `UPDATE … SET "<col>" = ?` (SQL). The ⌘S review modal lists changes
  by path. The optimistic post-commit update writes the value into the nested
  `documents` path (and the table cell when the path is a top-level field).
- **Out of scope:** adding/removing keys, reordering arrays, editing whole
  containers as JSON in the tree, editing nested values from the *table* (its nested
  cells stay whole-value JSON edits as today).

## Architecture

### Path utilities — `src/renderer/src/lib/doc-path.ts` (pure, tested)

```ts
/** A staged-edit key: row index + field path, NUL-separated (BSON field names can't
 *  contain NUL, so it can't collide with a path). */
export function editKey(rowIndex: number, path: string): string
export function parseEditKey(key: string): { rowIndex: number; path: string }

/** Read / immutably set a value at a dotted path (segments are object keys or array
 *  indices): getAtPath({a:{b:1}}, 'a.b') === 1; setAtPath(doc, 'a.b', 2) returns a new
 *  doc with a.b = 2, sharing untouched branches. */
export function getAtPath(root: unknown, path: string): unknown
export function setAtPath<T>(root: T, path: string, value: unknown): T

/** True for an EJSON wrapper object ({ $oid }, { $date }, { $numberLong }, …) — a single
 *  $-prefixed key — so the tree renders/edits it as one scalar value, not a sub-object. */
export function isEjsonWrapper(value: unknown): boolean
```

`editKey` replaces `dirtyKey`. The NUL separator keeps the flat `Record<string, unknown>`
edit map (no nested-map churn in the store).

### Staging changes (reuse, re-key)

- `edit-staging.ts`: `buildRowEdits(dirty, rows, editable)` → groups by row index (from
  `parseEditKey`), `set[path] = value`, skipping `path ∈ keyColumns`; the row key is still
  read from the `_id`/PK columns of `rows`. `describeEdits` resolves each edit's old value
  by path — a top-level path via the `rows` cell, a nested path via `getAtPath(documents[row], path)`.
- store `applyResultEdits(id, edits)` where each edit is now `{ rowIndex, path, value }`:
  patch `rows` when `path` is a top-level column (by name), and patch `documents[rowIndex]`
  via `setAtPath`.
- store `setCellEdit`/`resetCellEdit` already key by an opaque string — unchanged.

### Table view (`ResultsGrid`) — minimal change

A table cell stages with `editKey(rowIndex, columnSources[colIndex])` instead of the col
index; its dirty check and per-cell reset use the same. Behaviour identical (one column =
one top-level path). SQL keeps sending flat column-name paths.

### Tree view (`DocumentView`) — new editing

`DocumentView` receives the edit context (tabId, `editable`, `readOnly`, `requireCommit`,
`isMongo`, `edits`) from `ResultsPanel`. Each rendered leaf carries its `rowIndex`
(the top-level document index) and `path`. A leaf is editable when: the result is
editable, the connection isn't read-only, the path isn't `_id` (or under it), and the
value is a scalar or an EJSON wrapper (not a plain container). Double-click → the same
inline editor + `coerceMongoEditValue` the grid uses; dirty leaves highlight; **↺** resets
one leaf. Containers (`{…}`, `[…]`) stay structural.

### Driver — no change

`MongoDriver.applyEdits` already does `updateOne({_id}, {$set})` with `EJSON.deserialize`;
a dotted `$set` key (`"address.city"`, `"tags.0"`) is handled natively by Mongo. The
exactly-one-match guard and read-only refusal are unchanged. SQL `buildUpdate` already
keys `SET` by the (flat) path.

## Testing

- **Unit (pure):** `doc-path` (editKey round-trip; getAtPath/setAtPath incl. arrays,
  immutability, missing paths; isEjsonWrapper for each wrapper + negatives); `buildRowEdits`
  / `describeEdits` with nested paths; `applyResultEdits` patching a nested `documents`
  path and an array element; the table still works (top-level path).
- **Integration (Docker, Mongo):** a nested `$set` (`{"address.city": …}`) and an
  array-element `$set` (`{"tags.0": …}`) update the right place by `_id`; type preserved.
- **Live:** double-click a nested leaf in the tree → edit → ⌘S → review (paths shown) →
  Confirm → re-run confirms the nested value changed; `_id`/date wrappers not editable;
  table and tree stay in sync on a top-level edit.
