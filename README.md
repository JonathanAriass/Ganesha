<div align="center">

<img src="docs/logo.png" alt="Ganesha" width="120" height="150" />

# Ganesha

**A modern, fast, cross-platform database client — one window for PostgreSQL, MySQL, MariaDB and MongoDB.**

Monaco-powered query tabs, a virtualized results grid, in-place editing, an on-device AI assistant, and a ⌘K palette — without the heft of a classic Java client.

[![CI](https://github.com/JonathanAriass/Ganesha/actions/workflows/ci.yml/badge.svg)](https://github.com/JonathanAriass/Ganesha/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
<br/>
![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=9FEAF9)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

<!-- TODO: drop a screenshot at docs/screenshot.png (⌘⇧4 a clean window — avoid real
     hostnames/data since this repo is public) and uncomment the line below.
<img src="docs/screenshot.png" alt="Ganesha — query editor, results grid and schema browser" width="860" />
-->

</div>

---

Ganesha is a desktop client for the four databases people actually reach for, built to feel quick and trustworthy. Connections have a **read-only mode**: flip one switch and every query path is guarded — server-side read-only transactions *and* a statement guard — so you can point it at production and explore without fear. Passwords and SSH secrets are encrypted with the OS keychain and never read back into the UI. The AI assistant runs entirely on your machine; no data leaves the app.

## Contents

- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Install](#install)
- [Build from source](#build-from-source)
- [Architecture](#architecture)
- [Security posture](#security-posture)
- [Contributing](#contributing)
- [License](#license)

## Features

### Connect

- **Four engines, one app** — create, test, edit and color-code connections for PostgreSQL, MySQL, MariaDB and MongoDB. Passwords are encrypted with the OS keychain (Electron `safeStorage`) and are *write-only*: no IPC channel can read one back into the UI.
- **SSH tunnels** — reach a database through one or more SSH hops (a jump-server chain, e.g. bastion → private host), configured per connection. Each hop authenticates with a private key (+ optional passphrase) or a password; those secrets are keychain-encrypted and write-only too. The tunnel is opened in the main process and the drivers connect through it unchanged.
- **Read-only enforcement, twice** — on connections marked read-only, SQL is statement-guarded (writes/DDL rejected, including `SELECT INTO`) *and* runs inside a server-side `READ ONLY` transaction; Mongo commands pass an allow-list that also blocks `$out`/`$merge` aggregations.

### Explore & query

- **Schema browser** — tables, views and collections in a sidebar tree; double-click to open a ready-made query tab that runs itself. Filter the tree by name with a substring search box (matches object or schema names, highlights the hit). Leave a Mongo connection's database blank to browse *all* databases, Compass-style.
- **Query tabs** — Monaco editor with per-engine language (SQL or mongosh-style JavaScript), local workers, and custom Midnight/Daylight themes. Tab state (text, results, running query) survives switching — and the open tabs themselves survive an app restart (text only; nothing re-runs on launch). Double-click a tab to rename it; right-click for close actions (close others / to the right / to the left / all). With tabs open against more than one server they group into a two-level strip — pick a server, see its tabs.
- **Schema-aware autocomplete** — SQL tables/views, database/schema names, and the in-scope FROM/JOIN tables' columns (unqualified inside a `WHERE`, or after `alias.`/`table.`); Mongo collections after `db.`, document fields inside a method's argument, database names inside `getSiblingDB("…")`, and operation snippets after `db.coll.`.
- **Run exactly what you mean** — ⌘↵ runs the selection if there is one, else the statement under the cursor when the tab holds several, else the whole tab. ⌘⇧↵ runs *all* statements top-to-bottom as individual queries with per-statement collapsible results, stopping at the first error.
- **Saved queries** — name a snippet with ⌘S (or ☆) and it lives in the sidebar and the palette, per connection; click one to open it in a fresh tab and run it.
- **Two Mongo input modes** — raw EJSON commands (`{ "find": "users", … }`) or mongosh shell syntax (`db.users.find({…}).sort({…}).limit(5)`), parsed by a restricted AST evaluator — no code execution.

### Results

- **Virtualized grid** — TanStack Table + Virtual handles large result sets with instant client-side filtering, a collapsible JSON document view for Mongo, and CSV/JSON export that respects the active filter. Resize columns by dragging a header's edge, or double-click it to auto-fit.
- **Honest numbers** — when Mongo can't know the true total, the label says "showing first N (more available)" instead of inventing one. BIGINT/DECIMAL/Mongo Int64 values beyond JavaScript's safe range arrive as exact strings instead of silently rounding, and an explicit `{"$numberLong": "…"}` reaches the server as a true int64 — exact in both directions.
- **Row inspector** — click a row for every field at full value (JSON pretty-printed, copy keeps the original bytes), with copy-row and prev/next that follow the current sort/filter.
- **Edit in place** — double-click a cell to edit when the result maps to a single table with a primary key. Changed cells highlight as pending; **↺** reverts one cell. A per-connection *"require explicit commit"* switch stages edits until you confirm them in a review dialog (row, column, old→new) — the write runs as one transaction where each row must match exactly one row or the whole batch rolls back. Works across all four engines, including **nested Mongo values** in the JSON document view (`address.city`, `tags.0`), committed as a `$set` on that field path. Edits never build SQL in the renderer — drivers send parameterized statements.
- **Cancel & history** — long queries can be killed mid-flight (`pg_cancel_backend` / `KILL QUERY` / Mongo `killOp`). Every run is recorded (success or failure) and can be loaded back into a tab with one click.

### Assist

- **Local AI assistant** — a built-in chat powered by a GGUF model you download and run entirely on your machine (`node-llama-cpp`, no data leaves the app). It's grounded with the active connection's schema, so it recommends queries against your real tables; one click drops a suggestion into a new query tab. Manage models in-app (curated picks or any Hugging Face `hf:` URI); conversations are saved per connection.

### Comfort

- **⌘K palette** — fuzzy-jump to connections, tables/collections, saved queries and actions (cmdk).
- **Settings** — Midnight ⇄ Light theme (flash-free on launch) and a relocatable data directory (your data is copied, never lost).

## Keyboard shortcuts

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

## Install

Download the latest build for your platform from the [**Releases**](https://github.com/JonathanAriass/Ganesha/releases) page:

| Platform | Artifact |
|---|---|
| macOS | `.dmg` |
| Windows | `.exe` (NSIS installer) |
| Linux | `.AppImage` / `.deb` |

> **Heads up:** only the macOS build is exercised regularly. The Windows and Linux targets are configured but largely untested — [build from source](#build-from-source) if you hit trouble, and reports/PRs are welcome.

## Build from source

Requires **Node 20+** and npm. Docker is only needed for integration tests.

```bash
git clone https://github.com/JonathanAriass/Ganesha.git
cd Ganesha
npm install        # also rebuilds better-sqlite3 for Electron
npm run dev        # launch the app with hot reload
```

### Quality gates

```bash
npm run typecheck && npm run lint
npm test                  # 514 unit tests (Vitest, Node ABI)
npm run test:integration  # 35 tests vs real Postgres/MySQL/Mongo + an SSH tunnel (testcontainers, needs Docker)
```

CI (GitHub Actions) runs typecheck + lint + unit tests on every push.

### Packaging

```bash
npm run package:mac    # dmg in dist/
npm run package:win    # nsis
npm run package:linux  # AppImage + deb
```

## Architecture

```
src/
├── main/            # Electron main process
│   ├── drivers/     # DatabaseDriver implementations (pg, mysql2, mongodb)
│   │   └── mongo/   # EJSON/mongosh parsing, command guard, BSON normalization
│   ├── llm/         # on-device GGUF assistant (node-llama-cpp), schema grounding
│   ├── ssh/         # SSH tunnel manager (jump-server chain)
│   ├── persistence/ # better-sqlite3 store: connections, secrets, history, saved queries, session tabs, settings
│   ├── query-service.ts  # config + secret + read-only guard + driver + history
│   └── ipc.ts       # typed IPC channel handlers
├── preload/         # typed contextBridge surface (window.api)
├── renderer/        # React UI: zustand store, TanStack Query hooks, Monaco, cmdk
└── shared/          # IPC contract, Result<T>, domain & query types (no runtime deps)
```

Two ABIs of better-sqlite3 coexist: the production dependency is rebuilt for Electron (`postinstall`), while Vitest aliases to a Node-ABI copy so unit tests run without an Electron binary.

The full design spec and the per-feature implementation plans live in [`docs/superpowers/`](docs/superpowers/).

## Security posture

- The renderer runs sandboxed (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) behind a strict CSP.
- All main↔renderer traffic goes through one typed IPC contract (`src/shared/ipc.ts`); every handler returns a `Result<T>` envelope — no exceptions cross the bridge.
- Popups are denied and navigation is locked to the app itself (`will-navigate` compared by origin, deny on anything unparseable).
- Credentials never leave the main process in a plaintext-readable form.

Found a security issue? Please open a private report rather than a public issue (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Contributing

Contributions are welcome — see [**CONTRIBUTING.md**](CONTRIBUTING.md) for the dev setup, the quality gates every change must pass, and how the project is structured.

## License

[MIT](LICENSE) © [JonathanAriass](https://github.com/JonathanAriass)

## Acknowledgments

Built on the shoulders of [Electron](https://www.electronjs.org/), [electron-vite](https://electron-vite.org/), [React](https://react.dev/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [TanStack Table & Virtual](https://tanstack.com/), [node-llama-cpp](https://node-llama-cpp.withcat.ai/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), and the official `pg`, `mysql2` and `mongodb` drivers.
