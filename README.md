# DB Client

A modern, fast, cross-platform database client. One window for PostgreSQL, MySQL, MariaDB and MongoDB — Monaco-powered query tabs, a virtualized results grid, and a ⌘K palette, without the heft of a classic Java client.

Built with Electron, React and TypeScript (electron-vite). Connections have a **read-only mode**: flip one switch and every query path is guarded, so you can point it at a production database and explore without fear.

## Features

- **Connections** — create, test, edit and color-code connections for all four engines. Passwords are encrypted with the OS keychain (Electron `safeStorage`) and are *write-only*: no IPC channel can read one back into the UI.
- **Schema browser** — tables, views and collections in a sidebar tree; double-click to open a ready-made query tab that runs itself.
- **Query tabs** — Monaco editor with per-engine language (SQL or mongosh-style JavaScript), local workers, custom Midnight/Daylight themes. Tab state (text, results, running query) survives switching.
- **Two Mongo input modes** — raw EJSON commands (`{ "find": "users", ... }`) or mongosh shell syntax (`db.users.find({...}).sort({...}).limit(5)`), parsed by a restricted AST evaluator — no code execution.
- **Read-only enforcement, twice** — on connections marked read-only, SQL is statement-guarded (writes/DDL rejected, including `SELECT INTO`) *and* runs inside a server-side `READ ONLY` transaction; Mongo commands pass an allow-list that also blocks `$out`/`$merge` aggregations.
- **Results** — virtualized grid (TanStack Table + Virtual) that handles large result sets, instant client-side filtering, a collapsible document tree view for Mongo, CSV/JSON export.
- **Cancel** — long queries can be killed mid-flight (`pg_cancel_backend` / `KILL QUERY`; Mongo ops bound themselves via `maxTimeMS`).
- **History** — every run is recorded (success or failure) and can be loaded back into a tab with one click.
- **⌘K palette** — fuzzy-jump to connections, tables/collections and actions (cmdk).
- **Settings** — Midnight ⇄ Light theme (flash-free on launch) and a relocatable data directory (your data is copied, never lost).

### Keyboard shortcuts

| Chord | Action |
|---|---|
| ⌘K / Ctrl+K | Command palette |
| ⌘T / Ctrl+T | New query tab |
| ⌘W / Ctrl+W | Close tab |
| ⇧⌘W | Close window |
| ⌘, / Ctrl+, | Settings |
| ⌘↵ in editor | Run query |
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
npm test                  # 67 unit tests (Vitest, Node ABI)
npm run test:integration  # 12 tests vs real Postgres/MySQL/Mongo (testcontainers, needs Docker)
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
│   ├── persistence/ # better-sqlite3 store: connections, secrets, history, settings
│   ├── query-service.ts  # config + secret + read-only guard + driver + history
│   ├── menu.ts      # app menu (frees ⌘W for tab-close)
│   └── ipc.ts       # all 20 channel handlers
├── preload/         # typed contextBridge surface (window.api)
├── renderer/        # React UI: zustand store, TanStack Query hooks, Monaco, cmdk
└── shared/          # IPC contract, Result<T>, domain & query types (no runtime deps)
```

Two ABIs of better-sqlite3 coexist: the production dependency is rebuilt for Electron (`postinstall`), while Vitest aliases to a Node-ABI copy so unit tests run without an Electron binary.

The full design spec and the per-feature implementation plans live in [`docs/superpowers/`](docs/superpowers/).

## License

MIT © [JonathanAriass](https://github.com/JonathanAriass)
