# Object-tree name filter — design

## Problem

The sidebar object tree (`ObjectTree.tsx`) lists every table / view / collection of
the active connection, grouped by schema. On a database with many objects the list
is long and there is no way to narrow it. The user wants to **filter the tables by
name, in any way**.

## Decisions

- **Match style: substring ("contains").** Case-insensitive; the query must occur as
  a contiguous run in the target (`set` matches `43_settings`; `usr` does NOT match
  `users`). Predictable — what matches is literally a slice of the name. (An earlier
  draft used fuzzy subsequence; switched to substring on user preference.)
- **Match scope: object names + schema names.** No column/field matching — columns
  are lazy-loaded per node, so matching them would force an eager fetch of every
  table's columns. Matching a *schema* name surfaces all of that schema's objects.
- **Filter, do not re-rank.** Matches render in their original tree order; the tree
  structure stays stable as the user types (unlike the palette, which reorders).
- **Ephemeral state.** The query lives in component state and is cleared when the
  active connection changes. Not persisted across restarts.

## Architecture

Mirrors the existing pure-logic / thin-wiring split used by `completions.ts`,
`split.ts`, `statements.ts`, etc.

### Pure module — `src/renderer/src/lib/object-filter.ts`

```ts
/** Case-insensitive substring ("contains") match. Returns the matched character
 *  indices in `target` (the contiguous run, for highlighting), or null if `query`
 *  does not occur in `target`. An empty query returns [] (matches everything). */
export function substringMatch(query: string, target: string): number[] | null

/** True when the object should be shown for `query`: empty query → true; else a
 *  substring hit on the object name OR on its schema name. */
export function objectMatches(obj: DbObject, query: string): boolean

/** The objects to show, in original order (no re-ranking). Empty query → all. */
export function filterObjects(objects: DbObject[], query: string): DbObject[]
```

`substringMatch` is `target.toLowerCase().indexOf(query.toLowerCase())`; on a hit it
expands the start index into the contiguous run of positions so the component can
bold the original-case characters.

### Wiring — `src/renderer/src/components/ObjectTree.tsx`

- A filter `<input>` at the top of the `.tree` nav, pinned with `position: sticky;
  top: 0` and a solid background so rows scroll underneath. Placeholder
  `Filter tables…`. An `×` clear button appears when the query is non-empty;
  **Escape** clears the query.
- `query` held in `useState('')`, cleared via an effect on `activeConnectionId`.
- The success render computes `filterObjects(objects, query)` and groups the
  filtered set, so schema groups with no matches disappear. The grouped-vs-flat
  layout (`hasSchemas`) is decided from the *original* objects so it does not flip
  while typing.
- Each object name bolds its matched characters: a small `Highlighted` helper
  renders `substringMatch(query, obj.name)` positions (no highlight when the object
  matched only via its schema).
- A non-empty query with no matches renders a muted `No tables match "<query>"`.

The filter input only appears in the success path (objects loaded). The empty /
loading / error states are unchanged.

## Out of scope (v1)

- Column / field-name matching (needs eager column fetch).
- Persisting the filter across restarts or per-connection.
- Re-ordering results by match score.

## Testing

`src/renderer/src/lib/object-filter.test.ts` (pure, no React):

- `substringMatch`: contiguous run at start and mid-string, case-insensitivity,
  gapped query → null, absent → null, empty query → `[]`, correct matched positions,
  query longer than target → null.
- `objectMatches`: hit via name, hit via schema, empty query → true, miss → false.
- `filterObjects`: filters the list, preserves original order, empty query returns
  all, a schema-name query includes that schema's objects.

Component wiring (sticky input, clear button, Escape, highlight, no-match state,
reset on connection switch) verified live in the dev app. No driver / IPC changes,
so the integration suite is justifiably skipped.
