# Row inspector: structured JSON tree editor

## Problem
Editing a JSON-valued field in the docked row inspector uses a single-line text `EditingCell`
that hands back a plain **string**. The structured value is lost / re-encoded as a string instead
of staying JSON. (`RowInspector.tsx` — the SQL path stages the raw string as-is.)

## Approach — reuse the Documents-view tree
For a field whose value is a JSON container (an object/array, or a string that parses to one),
render the same editable `react18-json-view` tree the Documents view uses, instead of the
single-line editor. Editing a leaf **reconstructs the whole field value** and stages that at the
field's existing column key — so the value stays real JSON.

Whole-field staging (not per-leaf `$set` like the Documents view) is deliberate: it's one uniform
path that works for **both** engines. SQL binds the object → `jsonb`; Mongo `$set`s the field
object. The inspector keys edits by the top-level column (same key the grid uses for that column),
so grid ↔ inspector stay in sync.

## Pieces
- `lib/json-field.ts` — pure `asJsonTree(v)`: returns `{ tree, wasString }` when `v` is an
  object/array (`wasString:false`) or a string that parses to an object/array (`wasString:true`);
  `null` for scalars/plain strings (they keep the inline editor). `wasString` lets a re-serialized
  edit keep the field's string form (e.g. a `json`-as-text column) vs an object (`jsonb`/Mongo).
- `RowInspector.tsx`:
  - Per field, compute `asJsonTree(effectiveValue)`. When non-null AND the field is editable,
    render `<JsonView src={clone(tree)} editable onEdit=…>` (read-only tree when not editable).
    Non-JSON fields keep the current double-click `EditingCell`.
  - `onEdit(params)`: build the dotted path relative to the field (`[...parentPath, indexOrName]`,
    skip any `$`-prefixed EJSON-wrapper segment); `original = getAtPath(tree, path)`;
    `leaf = coerceLibraryEditValue(newValue, original)` (re-bias to the leaf's type);
    `next = setAtPath(structuredClone(tree), path, leaf)`;
    `stored = wasString ? JSON.stringify(next) : next`; stage `stored` at the field column key
    through the existing store buffer (`setCellEdit` / no-op reset / fast-commit) exactly like the
    current `stage()`.
  - A dirty field's tree reads the staged whole value (re-parsed when `wasString`).

## Commit path (unchanged, verified)
Staged value flows through the existing `commitEdits` → `edits.apply`:
- Mongo `applyEdits` `EJSON.deserialize`s the set object → `$set { field: <object> }`.
- SQL `applyEdits` binds the object as a parameter; node-pg serializes objects to JSON text →
  cast to `json`/`jsonb`. (The grid already stages objects for Mongo via `coerceMongoEditValue`,
  so the object path is exercised; SQL object-binding is verified against `postgres.ts` applyEdits.)

## Testing
- `asJsonTree` unit: object → tree/wasString:false; JSON-string → tree/wasString:true; scalar,
  plain string, null, malformed JSON → null.
- Reuse existing `doc-path` (getAtPath/setAtPath) + `coerceLibraryEditValue` (already tested).
- Manual: edit a Mongo subdocument field and a pg `jsonb` field from the inspector; commit; confirm
  the stored value is JSON, not a quoted string.

## Non-goals
- Per-leaf granular `$set` from the inspector (the Documents view already does that for Mongo).
- Adding keys / deleting keys in the tree (edit existing leaves only, matching the Documents view).
