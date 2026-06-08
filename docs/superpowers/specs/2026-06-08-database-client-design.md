# Modern Database Client — Design Spec

- **Date:** 2026-06-08
- **Status:** Approved (brainstorming) — ready for implementation planning
- **Author:** JonathanAriass

## 1. Overview

A cross-platform desktop database client — a modern, faster, friendlier alternative to
DBeaver for **personal daily use**. It connects to PostgreSQL, MySQL, MariaDB, and
MongoDB, and centers on a tight "core loop": connect → browse objects → write & run a
query → read results. The product bet is that a focused feature set with excellent UX
(instant interactions, virtualized data, keyboard-driven navigation) beats a
feature-exhaustive but heavy tool for one person's everyday work.

## 2. Goals & Non-Goals

### Goals
- **Personal daily driver** — optimize for the author's real tasks and for build velocity.
- **Modern, fast UX** — nothing blocks the UI; large result sets stay smooth; keyboard-first.
- **Cross-platform** — Windows, macOS, Linux from one codebase.
- **Four databases** — PostgreSQL, MySQL, MariaDB, MongoDB.
- **One language end-to-end** — TypeScript across the whole app for fast iteration.

### Non-Goals (v1)
- Not an enterprise/team tool: no accounts, telemetry, licensing, or collaboration.
- Not feature-exhaustive: no ER diagrams, import wizards, schema migrations, or
  data-transfer/ETL in v1.
- No inline (spreadsheet-style) grid editing in v1 — data is mutated by typing queries.
- No SQL autocomplete/IntelliSense in v1.
- No SSH tunneling in v1.
- No code-signing/notarization in v1 (local/personal builds).

## 3. Target Platforms & Databases

| Concern        | Decision                                                            |
|----------------|---------------------------------------------------------------------|
| OS             | Windows, macOS, Linux                                               |
| PostgreSQL     | `pg` driver                                                          |
| MySQL          | `mysql2` driver                                                      |
| MariaDB        | `mysql2` driver (same wire protocol as MySQL)                       |
| MongoDB        | `mongodb` official driver                                           |

## 4. v1 Scope (Features)

1. **Connection manager** — create / edit / test / save connections for all four database
   types. Per connection: host, port, user, database, **SSL/TLS** options, a **color/label**,
   and a **read-only safeguard** toggle. Passwords are never stored in plaintext.
2. **Object browser** — a lazy-loaded tree: databases/schemas → tables / views / collections
   → columns/fields + indexes. Children load on expand.
3. **Query editor**
   - **SQL** (Postgres/MySQL/MariaDB): Monaco editor with syntax highlighting; supports
     multiple statements; run all or run-at-cursor.
   - **MongoDB**: two interchangeable input modes in the query tab —
     - **Shell mode** — `mongosh`-style: `db.users.find({ age: { $gt: 21 } }).limit(50)`.
     - **Raw-JSON mode** — a structured command document.
4. **Results grid** — a **virtualized** table (renders only visible rows): sort, filter,
   paginate, copy cells, and **export to CSV / JSON**. For MongoDB, a **document/JSON tree
   view** complements the flat table view.
5. **Query history** — every executed query is logged per connection and can be re-run with
   one click.
6. **⌘K command palette** — jump to any connection, table/collection, or action by keyboard.
7. **Settings** — a configurable **data directory** (where connections + history are stored;
   point it at a synced folder to share across machines) and a **light/dark theme** toggle.

### Default look & feel
"Midnight" theme by default: dark, **indigo** accent, compact density, sans-serif. A light
theme is also supported; the toggle lives in Settings.

## 5. Deferred (v2+)

Inline grid editing · SQL autocomplete/IntelliSense · ER diagrams · import wizards · schema
migrations · SSH tunneling · multiple simultaneous result tabs per query · code-signing /
notarization.

## 6. Tech Stack

| Layer              | Choice                                                              |
|--------------------|---------------------------------------------------------------------|
| Shell              | **Electron**                                                        |
| UI                 | **React + TypeScript**                                              |
| Editor             | **Monaco**                                                          |
| Data grid          | **TanStack Table** + **TanStack Virtual** (virtualized rendering)   |
| Async/data caching | **TanStack Query** (over IPC)                                       |
| App state          | **Zustand**                                                         |
| DB drivers         | `pg`, `mysql2`, `mongodb` (all pure-JS)                             |
| Mongo shell parse  | `acorn` (parse to AST) + Extended JSON (EJSON) for BSON types       |
| Local persistence  | **better-sqlite3** (connections + history)                         |
| Secret storage     | Electron **`safeStorage`** (OS-backed encryption)                  |
| Packaging          | **electron-builder** (nsis / dmg / AppImage+deb)                   |
| Testing            | **Vitest**, **testcontainers**, React Testing Library              |

## 7. Architecture

### 7.1 Process model (Electron, two processes)

```
┌─────────────────────────────────────────────────────────┐
│  RENDERER  (React + TypeScript)                          │
│  Tabbed workspace · Monaco · virtualized grid · ⌘K       │
│  Pure UI — never imports a driver; calls window.api.*     │
└───────────────▲─────────────────────────────────────────┘
                │  typed IPC via contextBridge (narrow surface)
┌───────────────▼─────────────────────────────────────────┐
│  MAIN  ("backend", Node)                                 │
│  Driver pools · query exec + cancel · safeStorage ·      │
│  better-sqlite3 (connections, history) · file exports    │
└─────────────────────────────────────────────────────────┘
```

- **Main process** owns everything privileged: live driver connections/pools, credentials,
  query execution + cancellation, local persistence, file exports.
- **Preload** exposes a narrow, typed `window.api` via `contextBridge`. Security posture:
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where feasible.
- **Renderer** is pure UI and stateless with respect to databases — it only calls the typed
  API. This boundary is what keeps the UI responsive (all DB work is async and off the UI).

### 7.2 Database abstraction — one interface, three drivers

A single `DatabaseDriver` interface (in main):

```
connect(config) · testConnection(config) · disconnect()
listDatabases() / listSchemas() · listObjects(parent) · describeObject(ref)
runQuery(request, opts) · cancel(queryId)
```

- Implementations: `PostgresDriver` (`pg`), `MySQLDriver` (`mysql2`, serves MySQL **and**
  MariaDB), `MongoDriver` (`mongodb`).
- A `DriverRegistry` maps connection-type → driver factory. **Adding a fifth database later
  is one new module** implementing the interface — nothing else changes.
- **Normalized result shape** for tabular data:
  `{ columns: ColumnMeta[], rows: Row[], rowCount, durationMs, truncated }`.
  MongoDB results are adapted into **both** a flattened column view (dot-notation columns)
  **and** retained as raw documents for the JSON tree view.

### 7.3 MongoDB query translation

- **Shell mode:** the input is parsed to an AST with `acorn` (robust — not regex), validated
  against an allow-list of supported operations, and dispatched to the driver. v1 operations:
  `find`, `findOne`, `aggregate`, `count`/`countDocuments`, `distinct`, `insertOne`/`insertMany`,
  `updateOne`/`updateMany`, `deleteOne`/`deleteMany`, `replaceOne`. Argument objects are parsed
  as **Extended JSON** so `ObjectId`, `ISODate`, etc. round-trip correctly.
- **Raw-JSON mode:** a structured command document (e.g.
  `{ "op": "find", "collection": "users", "filter": {…}, "sort": {…}, "limit": 50 }`) maps
  directly to the driver. The two modes are a toggle within the Mongo query tab.

### 7.4 Frontend structure (renderer)

- **App state** (Zustand): open connections, tab set, active tab, theme.
- **Async data** (TanStack Query): object-tree nodes and query results, cached so re-opening a
  node or re-running history is instant.
- **Key components:** `ConnectionSwitcher`, `ObjectTree` (lazy), `TabBar`, `QueryTab`
  (Monaco + `ResultsPanel`), `DataTab`, `ResultsGrid` (virtualized), `DocumentView` (JSON tree
  for Mongo), `CommandPalette` (⌘K), `ConnectionForm`, `SettingsView`.

### 7.5 Layout

Tabbed workspace: a connection switcher on top, an object sidebar on the left, and a tabbed
main area. Double-clicking a table/collection opens a **data tab**; queries open their own
**query tabs** (editor over results).

## 8. Data Flow (example: running a SQL query)

1. User types SQL in a query tab and hits Run.
2. Renderer calls `window.api.runQuery({ connectionId, sql, opts })`; a `queryId` is returned
   immediately and the tab shows a cancelable running state.
3. Main resolves the connection's pool, enforces the **read-only guard** (see §9), executes
   asynchronously, and applies a **row cap** (default ~1000 with "load more") and timeout.
4. Main returns the normalized result `{ columns, rows, rowCount, durationMs, truncated }`.
5. Renderer renders it in the virtualized grid; the query is appended to **history**.
6. Cancel sends `cancel(queryId)`; main aborts via the driver's mechanism (e.g. Postgres
   cancel request, MySQL connection kill, Mongo `maxTimeMS`/cursor close).

## 9. Error Handling

- **Connection errors** (auth failed, host unreachable, SSL required) surface as clear,
  actionable messages on the connection form; `testConnection` exercises this before saving.
- **Query errors** (syntax, constraint violations) show the database's own message, with the
  editor position highlighted when the driver reports one.
- **Read-only guard:** when a connection is marked read-only, write/DDL statements are blocked
  **before** they reach the database, with an explanation. For SQL this is enforced by
  statement classification; for Mongo by the operation allow-list (only read ops permitted).
- **Mongo parse errors** (shell mode) are shown with location and the query is **not** executed.
- **Lost connections / driver errors** mark the connection disconnected and offer reconnect;
  pools recover on next use.
- **Truncated results** always show a clear "showing N of more" indicator — never a silent cap.
- **IPC errors** are returned as typed error results, never swallowed.

## 10. Performance ("fast UX") — concretely

Lazy-loaded object tree (children fetched on expand) · virtualized results grid (only visible
rows rendered) · pooled/reused connections · async-everything with cancelable queries ·
instant tab switching · cached tree/result data (TanStack Query) · ⌘K palette for
keyboard-speed navigation.

## 11. Testing Strategy

- **Unit (Vitest), test-first for high-risk pure logic:** the Mongo shell parser + EJSON
  handling, result normalization per driver, and the read-only statement guard.
- **Integration (testcontainers):** spin up real PostgreSQL, MySQL, and MongoDB in Docker and
  verify connect / list / describe / run / cancel against actual databases. This is the
  highest-value safety net for a database tool.
- **Component (React Testing Library):** command palette, results grid rendering/virtualization,
  and tab management.
- **(Later) E2E:** Playwright-for-Electron smoke tests.

## 12. Packaging

`electron-builder` produces installers for Windows (nsis), macOS (dmg), and Linux
(AppImage + deb). The DB drivers are pure-JS (no native build pain); `better-sqlite3` is the
one native dependency and ships prebuilt binaries. Code-signing/notarization is deferred.

## 13. Proposed Project Structure

```
src/
  main/                  Electron main ("backend")
    drivers/             postgres.ts, mysql.ts, mongo.ts, registry.ts, types.ts
    mongo/               parser.ts (acorn), ejson.ts
    persistence/         db.ts (better-sqlite3), connections.ts, history.ts, secrets.ts
    ipc.ts               typed IPC handlers
    main.ts              app/window bootstrap
  preload/
    bridge.ts            contextBridge — exposes window.api
  renderer/              React app
    components/          ConnectionSwitcher, ObjectTree, TabBar, QueryTab, DataTab,
                         ResultsGrid, DocumentView, CommandPalette, ConnectionForm, SettingsView
    state/               zustand stores
    lib/                 query client, formatters, export (CSV/JSON)
  shared/                types shared between main and renderer (IPC contracts, result shapes)
```

## 14. Open Questions / Future

- Saved queries / favorites and a richer history UI (history schema in SQLite leaves room).
- Whether to add SSH tunneling and inline editing in v2 first, based on real usage.
- Multiple result tabs per query and query-plan visualization.

## 15. Risks & Mitigations

- **Mongo shell parsing scope creep** — mitigate with a strict v1 operation allow-list and a
  raw-JSON fallback mode; parser is the first thing covered by tests.
- **Cancellation semantics differ per driver** — encapsulate behind `cancel(queryId)` and
  cover each driver in integration tests.
- **`better-sqlite3` native rebuilds across platforms** — rely on prebuilt binaries via
  electron-builder; keep it the only native dependency.
- **Electron footprint vs. "fast UX"** — perceived speed comes from virtualization, async work,
  and lazy loading, not the shell; budget for these from the start.
