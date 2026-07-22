# Telescope Inspector — Design

**Date:** 2026-07-22
**Status:** Proposed (awaiting review)
**Feature:** Port the standalone `telescope2` Laravel Telescope viewer into Ganesha as an in-app request inspector.

## Goal

When Ganesha is connected to a Laravel app's database that has **Laravel Telescope** installed, let the user open a full **Telescope inspector** — browse entries (HTTP requests, queries, exceptions, jobs, mail, logs, and 11 more types), inspect each entry's parsed detail, search/filter, follow a request's related child entries, and see new entries arrive live — all read-only, reusing Ganesha's existing connection.

The inspector auto-detects the Telescope tables and surfaces a 🔭 button; clicking it opens the inspector.

## Decisions (locked with the user)

1. **Scope:** All 17 entry types + batch **Related** correlation (full faithful browsing/inspection), text search, tag filter.
2. **Engine:** **MySQL / MariaDB first.** Code is structured so Postgres can be added later (a documented seam), but only MySQL is built + tested in this cut.
3. **Live tail:** Yes — main-side ~3s polling + a clickable "N new entries" banner.

### Deferred to follow-ups (NOT in this cut)

These telescope2 features are intentionally out of scope for the first cut. Any can be pulled in during review:
- Keyboard navigation (j/k/Enter//?/Esc/1–9)
- Export (JSON/CSV) + copy-entry-as-JSON
- Compare mode (side-by-side two detail panes)
- OS desktop notifications for new exceptions
- PostgreSQL support (detection + jsonb content)
- Custom Telescope table-name prefixes

## Non-negotiable constraints (carry over from Ganesha)

- **Read-only.** The inspector only issues author-controlled parameterized `SELECT`s wrapped in a `READ ONLY` transaction. The renderer never sends raw SQL — only structured filters. No edit affordances on Telescope tables.
- **No `app.setName` / package `name` stays `db-client`** (keychain/safeStorage). Not touched by this feature.
- **BigInt fidelity:** `telescope_entries.sequence` (BIGINT UNSIGNED) is carried as a **string** end-to-end (cursor + row id). Ganesha's drivers already return oversized integers as exact strings.
- **HTML safety:** `dump`/`mail` HTML content is shown as **escaped source** in a code block, never rendered as live HTML (XSS defense — matches telescope2's shipped behavior).

## Source-of-truth facts (from the understanding pass)

- Telescope tables read: **`telescope_entries`** and **`telescope_entries_tags`** only. `telescope_monitoring` is never queried.
- `telescope_entries` columns: `sequence` (BIGINT UNSIGNED, ordering key), `uuid` (CHAR 36), `batch_id` (CHAR 36), `family_hash` (nullable), `type` (varchar; SQL reserved word — quote it), `content` (LONGTEXT holding JSON), `created_at` (nullable TIMESTAMP). `should_display_on_index` (TINYINT) used only in `WHERE`.
- `telescope_entries_tags`: `entry_uuid` (CHAR 36), `tag` (varchar).
- Entry `type` values (17): `request, exception, query, log, job, mail, notification, cache, dump, schedule, command, gate, model, event, view, redis, batch`.
- Pagination is **cursor keyset on `sequence` DESC** (never OFFSET): `WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`. `hasMore = rows.length === limit`, `nextCursor = last row's sequence`.
- Content is parsed in code (JS `JSON.parse` of the LONGTEXT string), never in SQL.

---

## Architecture

Three layers, mirroring how Ganesha's existing `schema-diagram` tab is built end-to-end.

```
Renderer                         Main (Electron)                     MySQL (Laravel app DB)
────────                         ───────────────                     ─────────────────────
TopBar 🔭 button ─┐
CommandPalette ───┼─ openTelescopeTab(connId)
                  │        │
EditorPane ───────┘   'telescope' tab kind
   └ TelescopeView
        useTelescope* hooks ── window.api.telescope.* ── IPC handlers ── telescope-service ── driver.queryRaw ──▶ SELECT … telescope_entries
        onNewEntries()      ◀── telescope:new-entries  ◀── tail poller (setInterval, per connection)
```

### Data model — `src/shared/telescope.ts` (new)

Ported verbatim from telescope2's `src/lib/types.ts` (already framework-agnostic; all content fields optional). Discriminated unions on `type`.

```ts
export type TelescopeType =
  | 'request' | 'exception' | 'query' | 'log' | 'job' | 'mail'
  | 'notification' | 'cache' | 'dump' | 'schedule' | 'command'
  | 'gate' | 'model' | 'event' | 'view' | 'redis' | 'batch'

// sequence is a STRING to preserve BIGINT fidelity end-to-end.
export interface TelescopeEntry {
  sequence: string
  uuid: string
  batchId: string
  familyHash: string | null
  type: TelescopeType | string   // unknown/future types fall back to 'generic'
  createdAt: string | null       // raw DB string 'YYYY-MM-DD HH:MM:SS'
  summary: EntrySummary          // lightweight, per-type (list view)
}

export type EntrySummary =
  | { type: 'request'; method: string; uri: string; status: number; duration: number }
  | { type: 'query'; sql: string; duration: number; connection: string }
  | { type: 'exception'; class: string; message: string }
  | { type: 'log'; level: string; message: string }
  | { type: 'job'; name: string; status: string }
  | { type: 'mail'; subject: string; to: string }
  | { type: 'notification'; notification: string; channel: string }
  | { type: 'cache'; key: string; cacheType: string }
  | { type: 'dump'; preview: string }
  | { type: 'schedule'; command: string; expression: string }
  | { type: 'command'; command: string; exitCode: number }
  | { type: 'gate'; ability: string; result: string }
  | { type: 'model'; model: string; action: string }
  | { type: 'event'; name: string; listenerCount: number }
  | { type: 'view'; name: string; path: string }
  | { type: 'redis'; command: string; duration: string }  // redis time is a STRING
  | { type: 'batch'; name: string; progress: number; totalJobs: number }
  | { type: 'generic'; preview: string }

export interface TelescopeEntryDetail {
  sequence: string; uuid: string; batchId: string; familyHash: string | null
  type: string; createdAt: string | null
  content: EntryDetailContent   // per-type typed shape, or { type: 'raw'; data }
}

export interface TelescopePage { entries: TelescopeEntry[]; nextCursor: string | null; hasMore: boolean }
export interface TelescopeDetectResult { installed: boolean; present: string[] } // wanted-table names found
export interface TelescopeFilter { type: string | null; tag?: string | null; search?: string | null; beforeSequence?: string | null; limit?: number }
```

`EntryDetailContent` = union of per-type content interfaces (RequestContent, QueryContent, …) copied from telescope2's `types.ts`, plus `{ type: 'raw'; data: Record<string, unknown> }`.

---

## Backend (main process)

### New driver method: `queryRaw(id, sql, params) → Record<string,unknown>[]`

Ganesha's public `runQuery` takes only a SQL string (no bind params) and returns positional-array rows with editable-derivation overhead. For Telescope we add a small **read-only, parameterized, object-row** primitive to the SQL drivers.

- Add to `MySqlDriver` (`src/main/drivers/sql/mysql.ts`) now; add to `PostgresDriver` later (pg seam).
- Add optional `queryRaw?(id, sql, params): Promise<Record<string, unknown>[]>` to the `DatabaseDriver` interface (`src/main/drivers/types.ts`). Mongo does not implement it (Telescope is SQL-only).

MySQL implementation (mirrors the existing `applyEdits` parameterized pattern):

```ts
async queryRaw(id: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = this.requirePool(id)
  const conn = await pool.getConnection()
  try {
    await conn.query('START TRANSACTION READ ONLY')
    const [rows] = await conn.query(sql, params)   // object rows; JSON cols parsed; bigints exact per poolConfig
    await conn.query('COMMIT')
    return rows as Record<string, unknown>[]
  } catch (e) { try { await conn.query('ROLLBACK') } catch { /* ignore */ } ; throw e }
  finally { conn.release() }
}
```

### Telescope service — `src/main/telescope/` (new)

- **`queries.ts`** — the SQL (parameterized `?`, MySQL). Faithful port of telescope2's `queries.rs`:
  - **List by type (keyset):** `SELECT sequence, uuid, batch_id, family_hash, \`type\`, content, created_at FROM telescope_entries WHERE \`type\` = ? AND should_display_on_index = 1 [AND sequence < ?] ORDER BY sequence DESC LIMIT ?`
  - **Search / tags (dynamic builder):** when `search` present, drop the type filter and add `content LIKE CONCAT('%', ?, '%')` **and** the perf guard `sequence > (SELECT MAX(sequence) - 10000 FROM telescope_entries)`; when `tags` present, `INNER JOIN telescope_entries_tags t ON t.entry_uuid = e.uuid ... t.tag IN (?, …)` with `SELECT DISTINCT`. **Bind order:** tags…, search, type, cursor, limit.
  - **Detail by uuid:** `SELECT … FROM telescope_entries WHERE uuid = ?`
  - **Related by batch (no display filter, ASC):** `SELECT … FROM telescope_entries WHERE batch_id = ? [AND uuid != ?] ORDER BY sequence ASC LIMIT ?`
  - **Tags list:** `SELECT DISTINCT tag FROM telescope_entries_tags ORDER BY tag ASC`
  - **Tail (newer-than):** `SELECT … WHERE should_display_on_index = 1 AND sequence > ? ORDER BY sequence DESC LIMIT 100`
  - Defaults preserved: list limit **50**, tail LIMIT **100**, batch LIMIT **101**, search window **MAX(sequence)-10000**.
- **`parse.ts`** — TS port of telescope2's `parser.rs`. Two pure functions:
  - `parseEntrySummary(type, content) → EntrySummary` (manual per-type extraction + truncation + `shortClass`/`stripHtml`/`parseTime`).
  - `parseEntryDetail(type, content) → EntryDetailContent` (typed shape, else `{ type: 'raw', data: content }`).
  - Helpers exactly as specced: `parseTime` (number, or comma-string → float, else 0), `trunc`, `shortClass` (after last `\`), `stripHtml`. Special cases preserved: `redis.time` is a string; `cache.type`→`cacheType`; `command.exit_code`→`exitCode`; request summary reads `response_status`+`uri`.
- **`telescope-service.ts`** — orchestration: `detect(driver, c)`, `listEntries(driver, c, filter)`, `getEntry(driver, c, uuid)`, `getRelated(driver, c, batchId, excludeUuid)`, `getTags(driver, c)`, `tailSince(driver, c, lastSequence)`. Each: `connectStored(driver, c, secrets)` first (SSH-tunnel-aware), run parameterized SELECT via `queryRaw`, `JSON.parse` the `content` string (guarded), map rows → typed payloads. `content` on MySQL is a LONGTEXT string → `JSON.parse`; guard with try/catch → `{}` on malformed.
- **`tail.ts`** — the live poller. A `Map<connectionId, { timer, lastSequence, subscribers }>`. On `telescope.startTail(connectionId)`: seed `lastSequence` from current MAX (call `tailSince(…, '0')` and take the top row), then every **3000ms** run `tailSince(lastSequence)`, and if rows: update `lastSequence` to the max and push `{ connectionId, entries: TelescopeEntry[] }` over the `telescope:new-entries` channel. `telescope.stopTail(connectionId)` clears the timer. Pause when the BrowserWindow is unfocused (listen to `browser-window-blur/focus`), resume on focus.

### Detection

Reuse `driver.listObjects(c.id)` (already SSH-aware, cached-friendly) and check name membership — no new SQL, no schema-vs-database ambiguity:

```ts
const names = new Set((await driver.listObjects(c.id)).map((o) => o.name))
const present = ['telescope_entries', 'telescope_entries_tags'].filter((n) => names.has(n))
return { installed: present.includes('telescope_entries'), present }
```

Mongo connections return `{ installed: false }` (the name check naturally suppresses it).

### IPC channels (the standard 4-file pattern)

`src/shared/telescope.ts` types are imported into `src/shared/ipc.ts`.

| Channel | req | res |
|---|---|---|
| `telescope.detect` | `string` (connectionId) | `TelescopeDetectResult` |
| `telescope.entries` | `{ connectionId: string } & TelescopeFilter` | `TelescopePage` |
| `telescope.entry` | `{ connectionId: string; uuid: string }` | `TelescopeEntryDetail \| null` |
| `telescope.related` | `{ connectionId: string; batchId: string; excludeUuid?: string }` | `TelescopeEntry[]` |
| `telescope.tags` | `string` (connectionId) | `string[]` |
| `telescope.startTail` | `string` (connectionId) | `null` |
| `telescope.stopTail` | `string` (connectionId) | `null` |
| push `telescope:new-entries` | — | `{ connectionId: string; entries: TelescopeEntry[] }` |

Wired in: `src/shared/ipc.ts` (channel types + push-event payload), `src/shared/api.ts` (`telescope:` namespace + `onNewEntries` subscribe), `src/preload/index.ts` (bindings + `ipcRenderer.on('telescope:new-entries', …)` returning an unsubscribe), `src/main/ipc.ts` (handlers using `handle()/ok()/err()`, cloning the `schema.objects` handler skeleton). Telescope reads must **not** call `addHistory`.

---

## Frontend (renderer)

### Tab hosting — new `'telescope'` kind

- `src/renderer/src/state/store.ts`: widen `QueryTabData.kind` and `blankTab`'s param to include `'telescope'`; add `openTelescopeTab(connectionId)` (clone of `openDiagramTab`: single tab per connection, title `'🔭 Telescope'`).
- `src/renderer/src/components/EditorPane.tsx`: add one router branch → `<TelescopeView key={tab.id} connectionId={tab.connectionId} />`.
- No `TabBar` change (emoji-prefixed title is the icon). Session persistence: matches diagram (not restored across restart) — acceptable for v1.

### Entry points (detection-gated)

- `TopBar.tsx`: clone the schema-diagram icon button; show only when `useObjects(activeConn.id).some(o => o.name === 'telescope_entries')`. Add a `'telescope'` glyph to the `Icon` component.
- `CommandPalette.tsx`: add an "Open Telescope inspector" item guarded by the same check.

### `TelescopeView.tsx` (new) — 3-pane master-detail

Reskinned from telescope2 (Tailwind → Ganesha CSS vars). Structure:
- **Type list** (left, ~160px): the 17 types (icon + label), single-select; deselects visually when search is active.
- **Entries list** (middle): virtualized rows, 2-line 64px each (per-type primary/secondary + status badge), infinite scroll via cursor pagination, 3 empty states, the **NewEntriesBanner** pinned on top.
- **Detail pane** (right): header (title/metadata/uuid) + per-type **Tabs** (`ENTRY_TYPE_TABS`) dispatching to per-type detail renderers; a **Related** tab appears when `batchId` is set. Unknown types / parse failures → raw JSON.

Ported support modules (logic reused, restyled): `formatters.ts` (duration µs/ms/s, relative time, truncate), `telescope-types.ts` (`TELESCOPE_TYPES` registry + `ENTRY_TYPE_TABS`), the badge color buckets (HTTP status / log level / job / cache / gate / exit-code).

### Hooks — `src/renderer/src/lib/hooks.ts`

Follow the `useObjects` template (`window.api.telescope.*(…).then(unwrap)`, `enabled: connId != null`, `retry: false`):
- `useTelescopeEntries(connId, filter)` — `useInfiniteQuery`, key `['telescope','entries',connId,filter]`, `getNextPageParam` from `nextCursor`/`hasMore`.
- `useTelescopeEntry(connId, uuid)`, `useTelescopeRelated(connId, batchId, excludeUuid)`, `useTelescopeTags(connId)`.
- Live tail: a `useTelescopeTail(connId)` effect calls `telescope.startTail` on mount / `stopTail` on unmount, subscribes via `api.telescope.onNewEntries`, buffers up to 500 (newest-first), and exposes the count for the banner filtered to the current type. Clicking the banner merges + `queryClient.resetQueries(['telescope','entries',connId])`.

### Styling / reskin token map

telescope2 `@theme` token → Ganesha CSS var (add a `/* ── Telescope ── */` section at the end of `styles.css`):

| telescope2 | Ganesha |
|---|---|
| `--color-surface` `#0a0a0a` | `--bg` |
| `--color-surface-raised` `#141414` | `--bg-2` |
| `--color-surface-overlay` `#1a1a1a` | `--bg-3` / `--hover-overlay` |
| `--color-border` `#262626` | `--border` |
| `--color-text-primary` / `-secondary` | `--text` / `--text-2` |
| `--color-accent` `#3b82f6` | `--accent` |
| status 2xx/3xx/4xx/5xx, log/job/cache/gate colors | new `--tele-*` vars seeded from the hex values (`#22c55e`/`#eab308`/`#ef4444`/`#3b82f6`), theme-aware |

JSON payload/response rendering **reuses the app's existing `react18-json-view`-based `DocumentView`** (themed via `--json-*` vars) instead of prism, for visual consistency. SQL/stack/raw text render in a lightweight themed `<pre>` code block.

---

## File structure

**Create**
- `src/shared/telescope.ts` — shared types.
- `src/main/telescope/queries.ts`, `parse.ts`, `telescope-service.ts`, `tail.ts`.
- `src/renderer/src/components/TelescopeView.tsx` (+ small sub-components: `TelescopeTypeList`, `TelescopeEntryRow`, `TelescopeDetail`, `TelescopeNewEntriesBanner`, per-type detail renderers).
- `src/renderer/src/lib/telescope-format.ts` (formatters), `src/renderer/src/lib/telescope-types.ts` (registry + tab config).
- Test files alongside: `parse.test.ts`, `queries.test.ts` (bind-order/paging), `telescope-format.test.ts`, and store-action tests.

**Modify**
- `src/main/drivers/types.ts` (interface `queryRaw?`), `src/main/drivers/sql/mysql.ts` (`queryRaw`).
- `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts` (channels + handlers).
- `src/renderer/src/state/store.ts` (kind + `openTelescopeTab`), `EditorPane.tsx` (branch), `TopBar.tsx` (+ `Icon`), `CommandPalette.tsx`, `lib/hooks.ts`, `styles.css`.

## Testing strategy

- **Pure logic (unit, most valuable):** `parse.ts` — every entry type's summary + detail, the `raw` fallback, `parseTime` comma-strings, `redis.time` string, `shortClass`, `stripHtml`, truncation lengths. `queries.ts` — the dynamic search/tag builder produces the correct SQL + **bind order** for each filter combination; keyset `WHERE sequence < ?`. `telescope-format.ts` — duration buckets, relative time. Store — `openTelescopeTab` de-dupes per connection.
- **Integration (against a real Telescope DB):** spin up a MySQL container, load a minimal `telescope_entries`/`telescope_entries_tags` fixture (a request + its batch children + a few types), assert `detect`, `listEntries` paging, `getEntry`, `getRelated`, `getTags`, and one `tailSince` round. Reuse Ganesha's existing integration-test harness.
- **Manual:** connect to the user's real Laravel MySQL DB, verify the 🔭 button appears, browse + inspect + search + Related + live tail.

## Implementation phases (ordered)

1. **Shared types + MySQL `queryRaw`** — `src/shared/telescope.ts`, driver method (+ interface), unit test `queryRaw` read-only.
2. **Parser + queries** — `parse.ts` (+ tests), `queries.ts` (+ bind-order tests). Pure, no IPC.
3. **Service + detection + IPC** — `telescope-service.ts`, `telescope.detect/entries/entry/related/tags` channels wired through all 4 files; integration test.
4. **Tab + entry points** — store kind + `openTelescopeTab`, `EditorPane` branch, `TopBar`/`CommandPalette` gated buttons, `Icon`.
5. **TelescopeView UI** — type list + entries list (virtualized, infinite scroll) + detail pane + per-type detail renderers + badges + reskin CSS. Hooks in `lib/hooks.ts`.
6. **Live tail** — `tail.ts` poller + `telescope:startTail/stopTail/new-entries`, `useTelescopeTail`, NewEntriesBanner, pause-on-blur.
7. **Polish + full test/typecheck/lint pass**, README note.

## Risks & mitigations

- **BIGINT `sequence` precision** → carry as string everywhere; bind cursor as a numeric string (`WHERE sequence < ?` compares fine in MySQL). Covered by tests.
- **Malformed / huge `content`** → guarded `JSON.parse` (→ raw fallback), truncate large fields in the UI, escape HTML.
- **Live tail vs connection pool / SSH tunnels** → poller uses the same `connectStored` pool; stop on tab close + pause on blur to avoid idle load; single timer per connection.
- **Keyboard-shortcut collisions** (deferred feature) → not in this cut; when added, gate to the focused inspector pane only.
- **Reserved word `type`** → always backtick-quote in MySQL SQL.

## Postgres seam (future)

To add pg later: implement `queryRaw` on `PostgresDriver`, add `$n` placeholder generation + `LIKE ('%' || $x || '%')` in `queries.ts` behind a per-engine branch, and adjust detection to schema-scoped `information_schema` (or keep the `listObjects` name check, which already works). `content` is `jsonb` → already a parsed object on pg (skip `JSON.parse`). No renderer changes.
