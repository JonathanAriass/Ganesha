# Friendly date/timestamp formatting in the results grid — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming)
**Branch:** `feat/schema-diagram` (current working branch).

## Goal

Display SQL date / time / timestamp columns (e.g. Laravel `created_at`, `datetime`
columns) in the results grid in a friendly **day-first** format instead of the raw
DB string. Chosen format: **`24-06-2024 14:30:00`** (DD-MM-YYYY HH:MM:SS).

Formatting is **display-only**: copy, CSV/JSON export, and cell editing keep the
**raw** stored value (full precision / timezone / round-trippable).

## Current behavior

- **Postgres** returns date/time/timestamp columns as raw strings (identity parser on
  OIDs 1082/1083/1114/1184/1266/1186); the result column `dataType` is the **OID** as a
  string (e.g. `"1114"`).
- **MySQL/MariaDB** use `dateStrings: true` → `"2024-06-24 14:30:00"`; the result column
  `dataType` is the **mysql2 type code** as a string (DATETIME `12`, TIMESTAMP `7`,
  DATE `10`, TIME `11`, YEAR `13`, NEWDATE `14`).
- The grid renders every cell via `cellText(v)` = `String(v)`, so the raw string shows
  verbatim (`2024-06-24 14:30:00.123456+00`).

## Design

### 1. Detection — `src/renderer/src/lib/date-format.ts` (new, pure)

```ts
export type DateKind = 'date' | 'time' | 'datetime'
export type SqlDialect = 'postgres' | 'mysql'

/** The date kind of a result column, from the driver's type code + dialect; null = not a
 *  date/time column (or a kind we deliberately don't reformat: pg interval, mysql YEAR). */
export function dateColumnKind(dataType: string | null, dialect: SqlDialect): DateKind | null
```

- **postgres** (OID): `1082 → date`; `1083, 1266 → time`; `1114, 1184 → datetime`.
  `1186` (interval) → `null` (a duration, not a calendar value).
- **mysql** (type code): `10, 14 → date`; `11 → time`; `7, 12 → datetime`.
  `13` (YEAR) → `null` (a bare year number).
- unknown / other → `null`.

### 2. Formatter — `formatDbDate`

```ts
/** Reformat a raw SQL date/time string to day-first display. Parses the wall-clock
 *  components with a regex and reorders them — NO Date/timezone conversion, so a
 *  timestamptz is shown exactly as stored (just reordered), and a value that doesn't
 *  match the expected shape (NULL, MySQL out-of-range TIME, etc.) is returned unchanged. */
export function formatDbDate(value: unknown, kind: DateKind): string
```

- Extract `YYYY-MM-DD` (optional) and `HH:MM:SS` (optional, ignoring any `.ffffff`
  fractional part and any `±HH[:MM]` offset).
- Output: `datetime → DD-MM-YYYY HH:MM:SS`, `date → DD-MM-YYYY`, `time → HH:MM:SS`.
- If `value` isn't a string, or the regex doesn't match the kind's required parts,
  fall back to `cellText(value)` (the raw text) — robust passthrough.

A convenience used by the grid:

```ts
/** Formatted display for a cell when its column is a date kind, else the raw cellText. */
export function displayCellText(value: unknown, kind: DateKind | null): string
```

### 3. Wiring — `ResultsGrid.tsx`

The grid receives a per-column `columnKinds: (DateKind | null)[]` computed by the
parent (`ResultsPanel`, where `isMongo`/the connection type is already known): for
postgres/mysql/mariadb map each `columns[i].dataType` via `dateColumnKind`; for mongodb
the array is all-`null`.

In the cell render (currently `const text = cellText(raw)`), split display from raw:
- `const raw = isDirty ? edits[dk] : cell.getValue()`
- `const rawText = cellText(raw)` — used for copy + the hover `title` (full precision).
- `const display = displayCellText(raw, columnKinds[colIndex])` — the shown text.
- Render `display`; set `title={rawText}`; the read-only double-click **copies `rawText`**.
- `EditingCell` still opens `raw` (editing unchanged).
- Auto-fit measures `display` (the shown text).

Filter: the `globalFilterFn` matches the filter against **both** the raw and the
formatted text, so typing either `2024-06-24` or `24-06-2024` finds the row. A small
pure helper `cellMatchesDateAware(value, kind, filter)` (in `date-format.ts` or
`grid-text.ts`) expresses this; `getColumnCanGlobalFilter` stays `true`.

### 4. Scope / non-goals

- **In:** SQL (pg/mysql/mariadb) date/time/timestamp columns in the results grid.
- **Raw (unchanged):** copy, CSV/JSON export, cell editing/staging/commit, the hover
  tooltip, and the **row inspector** side panel (the "exact value" view).
- **Out (YAGNI):** Mongo date fields (a different representation — `Date`/EJSON `{$date}`,
  detected by value not column type); a user toggle between raw/formatted; locale-driven
  formatting. Mongo grids get all-`null` kinds, so nothing changes for them.

### 5. Testing

`lib/date-format.test.ts` (pure):
- `dateColumnKind`: each pg OID and mysql code → the right kind; `1186`/`13` → null;
  unknown → null; both dialects.
- `formatDbDate`: `2024-06-24 14:30:00.123456+00` (datetime) → `24-06-2024 14:30:00`;
  `2024-06-24` (date) → `24-06-2024`; `14:30:00.5` (time) → `14:30:00`;
  mysql `2024-06-24 14:30:00` (datetime) → `24-06-2024 14:30:00`; passthrough on a
  non-matching value and on a non-string.
- `displayCellText`: null kind → `cellText`; date kind → formatted.
- `cellMatchesDateAware`: matches both raw and formatted spellings.

No driver / IPC / shared-contract changes. Renderer-only.
