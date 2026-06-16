# DB Client

A modern, fast, cross-platform database client. One window for PostgreSQL, MySQL, MariaDB and MongoDB — Monaco-powered query tabs, a virtualized results grid, and a ⌘K palette, without the heft of a classic Java client.

Built with Electron, React and TypeScript (electron-vite). Connections have a **read-only mode**: flip one switch and every query path is guarded, so you can point it at a production database and explore without fear.

## Features

- **Connections** — create, test, edit and color-code connections for all four engines. Passwords are encrypted with the OS keychain (Electron `safeStorage`) and are *write-only*: no IPC channel can read one back into the UI.
- **SSH tunnels** — reach a database through one or more SSH hops (a jump-server chain, e.g. bastion → private host), configured per connection. Each hop authenticates with a private key (+ optional passphrase) or a password; passphrases/passwords are encrypted with the OS keychain and write-only like DB passwords. The tunnel is opened in the main process and the drivers connect through it unchanged.
- **Local AI assistant** — a built-in chat powered by a GGUF model you download and run entirely on your machine (`node-llama-cpp`, no data leaves the app). It's grounded with the active connection's schema, so it recommends queries against your real tables; one click drops a suggestion into a new query tab. Download/manage models in-app (curated picks or any Hugging Face `hf:` URI); conversations are saved per connection.
- **Schema browser** — tables, views and collections in a sidebar tree; double-click to open a ready-made query tab that runs itself. Filter the tree by name with a substring search box at the top (matches object or schema names, highlights the hit). Leave a Mongo connection's database blank to browse *all* databases, Compass-style.
- **Query tabs** — Monaco editor with per-engine language (SQL or mongosh-style JavaScript), local workers, custom Midnight/Daylight themes. Tab state (text, results, running query) survives switching — and the open tabs themselves survive an app restart (text only; nothing re-runs on launch). Double-click a tab to rename it; names persist too.
- **Autocomplete** — schema-aware: SQL tables/views, database/schema names, and the in-scope FROM/JOIN tables' columns offered unqualified (e.g. inside a `WHERE`) as well as after `alias.`/`table.`, objects after `schema.`; Mongo collections after `db.`, document fields inside a method's argument, database names inside `getSiblingDB("…")`, and operation snippets after `db.coll.`. MySQL identifiers that start with a digit (e.g. `43_settings`) are recognized too.
- **Run exactly what you mean** — ⌘↵ runs the selection if there is one, else the statement under the cursor when the tab holds several, else the whole tab. ⌘⇧↵ (or ▶▶) runs *all* statements top-to-bottom as individual queries with per-statement collapsible results, stopping at the first error; scripts that need `BEGIN`/`COMMIT` to span statements are refused up front instead of silently misbehaving on pooled connections.
- **Saved queries** — name a snippet with ⌘S (or ☆) and it lives in the sidebar and the palette, per connection.
- **Two Mongo input modes** — raw EJSON commands (`{ "find": "users", ... }`) or mongosh shell syntax (`db.users.find({...}).sort({...}).limit(5)`), parsed by a restricted AST evaluator — no code execution.
- **Read-only enforcement, twice** — on connections marked read-only, SQL is statement-guarded (writes/DDL rejected, including `SELECT INTO`) *and* runs inside a server-side `READ ONLY` transaction; Mongo commands pass an allow-list that also blocks `$out`/`$merge` aggregations.
- **Results** — virtualized grid (TanStack Table + Virtual) that handles large result sets, instant client-side filtering, a collapsible document tree view for Mongo, CSV/JSON export that respects the active filter. Row counts are honest: when Mongo can't know the true total, the label says "showing first N (more available)" instead of inventing one. Numbers are honest too: BIGINT/DECIMAL/Mongo Int64 values beyond JavaScript's safe range arrive as exact strings instead of silently rounding — and an explicit `{"$numberLong": "…"}` in a raw Mongo command reaches the server as a true int64, exact in both directions. Click a row to open the **inspector** — every field at full value (JSON pretty-printed, copy keeps the original bytes), with copy-row and prev/next that follow the current sort/filter. Drag the divider between the editor and the grid to resize them (double-click to reset, arrow keys when it's focused); the split is remembered.
- **Cancel** — long queries can be killed mid-flight (`pg_cancel_backend` / `KILL QUERY` / Mongo `killOp` via comment-tagged `$currentOp`). During a script run, Cancel also stops at the next statement boundary.
- **History** — every run is recorded (success or failure) and can be loaded back into a tab with one click.
- **⌘K palette** — fuzzy-jump to connections, tables/collections, saved queries and actions (cmdk).
- **Settings** — Midnight ⇄ Light theme (flash-free on launch) and a relocatable data directory (your data is copied, never lost).

### Keyboard shortcuts

| Chord | Action |
|---|---|
| ⌘K / Ctrl+K | Command palette |
| ⌘T / Ctrl+T | New query tab |
| ⌘W / Ctrl+W | Close tab |
| ⇧⌘W | Close window |
| ⌘, / Ctrl+, | Settings |
| ⌘S / Ctrl+S | Save query as snippet |
| ⌘↵ in editor | Run selection → statement at cursor → whole tab |
| ⇧⌘↵ in editor | Run all statements |
| Esc | Close overlay |

## Security posture

- Renderer runs sandboxed (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) behind a strict CSP.
- All main↔renderer traffic goes through one typed IPC contract (`src/shared/ipc.ts`); every handler returns a `Result<T>` envelope — no exceptions cross the bridge.
- Popups are denied and navigation is locked to the app itself (`will-navigate` compared by origin, deny on anything unparseable).
- Credentials never leave the main process in plaintext readable form.

## Getting started

Requires Node 20+ and npm. Docker is only needed for integration tests.

```bash
npm install        # also rebuilds better-sqlite3 for Electron
npm run dev        # launch the app with hot reload
```

### Quality gates

```bash
npm run typecheck && npm run lint
npm test                  # 399 unit tests (Vitest, Node ABI)
npm run test:integration  # 17 tests vs real Postgres/MySQL/Mongo + an SSH tunnel (testcontainers, needs Docker)
```

CI (GitHub Actions) runs typecheck + lint + unit tests on every push.

### Packaging

```bash
npm run package:mac    # dmg in dist/
npm run package:win    # nsis
npm run package:linux  # AppImage + deb
```

> Only the macOS build is exercised regularly; Windows/Linux targets are configured but untested.

## Architecture

```
src/
├── main/            # Electron main process
│   ├── drivers/     # DatabaseDriver implementations (pg, mysql2, mongodb)
│   │   └── mongo/   # EJSON/mongosh parsing, command guard, BSON normalization
│   ├── persistence/ # better-sqlite3 store: connections, secrets, history, saved queries, session tabs, settings
│   ├── query-service.ts  # config + secret + read-only guard + driver + history
│   ├── menu.ts      # app menu (frees ⌘W for tab-close)
│   └── ipc.ts       # all 26 channel handlers
├── preload/         # typed contextBridge surface (window.api)
├── renderer/        # React UI: zustand store, TanStack Query hooks, Monaco, cmdk
└── shared/          # IPC contract, Result<T>, domain & query types (no runtime deps)
```

Two ABIs of better-sqlite3 coexist: the production dependency is rebuilt for Electron (`postinstall`), while Vitest aliases to a Node-ABI copy so unit tests run without an Electron binary.

The full design spec and the per-feature implementation plans live in [`docs/superpowers/`](docs/superpowers/).

## License

MIT © [JonathanAriass](https://github.com/JonathanAriass)
