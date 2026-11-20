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

- **Four engines, one app** — create, test, edit and color-code connections for PostgreSQL, MySQL, MariaDB and MongoDB, shown as cards on a connections dashboard you can organize into **groups and subgroups** by drag-and-drop. The dashboard has a **filter** (name, host or engine), richer cards and one action row. Passwords are encrypted with the OS keychain (Electron `safeStorage`) and are *write-only*: no IPC channel can read one back into the UI.
- **SSH tunnels** — reach a database through one or more SSH hops (a jump-server chain, e.g. bastion → private host), configured per connection. Each hop authenticates with a private key (+ optional passphrase) or a password; those secrets are keychain-encrypted and write-only too. The tunnel is opened in the main process and the drivers connect through it unchanged.
- **Export & import** — move your setup to another machine or hand your connections to teammates: **Export…** on the dashboard writes the connections you pick (with their groups and subgroups) to a `.ganesha-connections` file, and **Import…** adds them to another install. Passwords and SSH secrets stay out of the file unless you opt in, in which case they're encrypted with a passphrase you choose (AES-256-GCM, scrypt-derived key) — share the passphrase separately. Importing never changes what you already have: connections you already have are skipped and groups are matched by name. Saved queries, history and SSM tunnels aren't included.
- **Import from MongoDB Compass and DBeaver** — the same **Import…** button also reads a Compass connections export (with its passwords, whether in the clear or protected by the export passphrase) and DBeaver's `data-sources.json` (found in the project's `.dbeaver` folder; user names, passwords and SSH tunnels with jump servers come from the `credentials-config.json` next to it, DBeaver folders become groups). You choose whether passwords come along; they go into the encrypted store. Entries Ganesha can't open (other engines, `mongodb+srv` addresses) are listed and left out, and a DBeaver project protected by a master password imports without credentials. When DBeaver or Compass is installed on the machine, **Import…** lists them and reads their saved connections directly, with no file to look for; on macOS the passwords saved in Compass can come along too: they are protected by a key in the keychain, so macOS asks for your permission when you import them (on Windows and Linux they are left behind). Imported connections go into a group named after the tool and keep a tag saying where they came from.
- **Connection sidebar** — every open connection is one click away, no dashboard or dropdown: the sidebar's top zone lists your connections grouped as on the dashboard, and the explorer below follows the active one. ⌘B collapses the sidebar to a single badge per open connection (initials with the connection's colour bar; its accessible name carries the environment and read-only state).
- **Environment label** — give a connection an optional free-text environment (up to 12 characters; suggestions PROD / STG / DEV / LOCAL). It shows as a tag in the sidebar, the environment bar and the dashboard, always as text rather than colour alone, and travels with export/import.
- **Read-only enforcement, twice** — on connections marked read-only, SQL is statement-guarded (writes/DDL rejected, including `SELECT INTO`) *and* runs inside a server-side `READ ONLY` transaction; Mongo commands pass an allow-list that also blocks `$out`/`$merge` aggregations.

### Explore & query

- **Schema browser** — tables, views and collections in a tree, in the sidebar's explorer zone, which has a Schema / Saved / History switch for the active connection; double-click to open a ready-made query tab that runs itself. Filter the tree by name with a substring search box (matches object or schema names, highlights the hit). Leave a Mongo connection's database blank to browse *all* databases, Compass-style.
- **Query tabs** — Monaco editor with per-engine language (SQL or mongosh-style JavaScript), local workers, and custom Midnight/Daylight themes. Tab state (text, results, running query) survives switching — and the open tabs themselves survive an app restart (text only; nothing re-runs on launch). Double-click a tab to rename it; right-click for close actions (close others / to the right / to the left / all). Tabs sit in a single pill strip with an **All tabs / This connection** switch, so with several servers open you can see everything or just the active connection's tabs.
- **Environment bar** — under the tab strip, each pane names its connection, its mode ("Read-only — writes are blocked" or "Edits stage until you commit") and host, and carries Refresh, Save, Run all, Run and Cancel.
- **Schema-aware autocomplete** — SQL tables/views, database/schema names, and the in-scope FROM/JOIN tables' columns (unqualified inside a `WHERE`, or after `alias.`/`table.`); Mongo collections after `db.`, document fields inside a method's argument, database names inside `getSiblingDB("…")`, and operation snippets after `db.coll.`.
- **Run exactly what you mean** — ⌘↵ runs the selection if there is one, else the statement under the cursor when the tab holds several, else the whole tab. ⌘⇧↵ runs *all* statements top-to-bottom as individual queries with per-statement collapsible results, stopping at the first error.
- **Saved queries** — save a query with the Save button in the environment bar and it lives in the sidebar's Saved view and the palette, per connection; click one to open it in a fresh tab and run it.
- **Two Mongo input modes** — raw EJSON commands (`{ "find": "users", … }`) or mongosh shell syntax (`db.users.find({…}).sort({…}).limit(5)`), parsed by a restricted AST evaluator — no code execution.
- **Telescope inspector** — connect to a Laravel app's database with [Telescope](https://laravel.com/docs/telescope) installed and a 🔭 button (also in the ⌘K palette) opens a built-in inspector. Browse every entry type — requests, queries, exceptions, jobs, mail, logs and 11 more — in a virtualized list with per-type detail panes (request headers/payload/response, SQL + bindings, collapsible stack traces with vendor frames folded away), text search across all content, a tag filter, and a **Related** tab that follows a request's child entries by batch. New entries stream in live — a "*N* new entries" banner surfaces them without moving your scroll. Strictly read-only: only parameterized `SELECT`s inside a server-side `READ ONLY` transaction, the renderer never builds SQL, and Telescope tables are never editable. Auto-detected from the `telescope_entries` table (MySQL/MariaDB).

### Results

- **Virtualized grid** — TanStack Table + Virtual handles large result sets with instant client-side filtering, a collapsible JSON document view for Mongo, and CSV/JSON export that respects the active filter. Resize columns by dragging a header's edge, or double-click it to auto-fit.
- **Honest numbers** — when Mongo can't know the true total, the label says "showing first N (more available)" instead of inventing one. BIGINT/DECIMAL/Mongo Int64 values beyond JavaScript's safe range arrive as exact strings instead of silently rounding, and an explicit `{"$numberLong": "…"}` reaches the server as a true int64 — exact in both directions.
- **Row inspector** — click a row for every field at full value (JSON pretty-printed, copy keeps the original bytes), with copy-row and prev/next that follow the current sort/filter.
- **Edit in place** — double-click a cell to edit when the result maps to a single table with a primary key. Changed cells highlight as pending; **↺** reverts one cell. A per-connection *"require explicit commit"* switch stages edits until you confirm them in a review dialog (row, column, old→new) — the write runs as one transaction where each row must match exactly one row or the whole batch rolls back. Works across all four engines, including **nested Mongo values** in the JSON document view (`address.city`, `tags.0`), committed as a `$set` on that field path. Edits never build SQL in the renderer — drivers send parameterized statements.
- **Cancel & history** — long queries can be killed mid-flight (`pg_cancel_backend` / `KILL QUERY` / Mongo `killOp`). Every run is recorded (success or failure) and can be loaded back into a tab with one click.

### Assist

- **Local AI assistant** — a built-in chat, in the right dock beside the Tunnels tab, powered by a GGUF model you download and run entirely on your machine (`node-llama-cpp`, no data leaves the app). It's grounded with the active connection's schema, so it recommends queries against your real tables; one click drops a suggestion into a new query tab. Manage models in-app (curated picks or any Hugging Face `hf:` URI); conversations are saved per connection. The inference engine runs in a **separate, crash-isolated process** — a native model/inference fault can never take down the app — and its ~2 MB native binaries are **downloaded on first use** rather than shipped inside the app (which also keeps macOS Gatekeeper/XProtect from flagging the unsigned bundle).
- **Linked-repo context** *(optional)* — point a connection at a local code repo and the assistant pulls the relevant files (ORM models, migrations, entities) into its context for the tables you're asking about, so suggestions match your app's real relationships and conventions — not just the bare schema. Retrieval is question-driven (it matches your message and the open query against the connection's known tables), bounded, and local; a small **📎 context** line shows exactly which files were read. PHP/Laravel naming is tuned (`users` ↔ `User.php` ↔ `…_create_users_table.php`), with a generic fallback.

### Comfort

- **⌘K palette** — fuzzy-jump to connections, tables/collections, saved queries and actions (cmdk).
- **Settings** — Midnight ⇄ Light theme (flash-free on launch), a **Comfortable / Compact** density (comfortable by default) and a relocatable data directory (your data is copied, never lost).

## Keyboard shortcuts

| Chord | Action |
|---|---|
| ⌘K / Ctrl+K | Command palette |
| ⌘B / Ctrl+B | Toggle the sidebar |
| ⌘T / Ctrl+T | New query tab |
| ⌘W / Ctrl+W | Close tab |
| ⇧⌘W | Close window |
| ⌘, / Ctrl+, | Settings |
| ⌘S / Ctrl+S | Save query as snippet |
| ⌘↵ in editor | Run selection → statement at cursor → whole tab |
| ⇧⌘↵ in editor | Run all statements |
| Esc | Close overlay |

## Install

### Homebrew (macOS)

```sh
brew tap jonathanariass/tap
brew trust jonathanariass/tap   # Homebrew 6.0+: confirm you trust this third-party tap (one-time)
brew install --cask ganesha
```

On Homebrew older than 6.0 the `brew trust` line doesn't exist and isn't needed — `brew install --cask jonathanariass/tap/ganesha` works on its own.

Ganesha isn't signed or notarized by Apple yet, so macOS quarantines it and — on Apple Silicon — may report it as **"Ganesha is damaged and can't be opened"** (_"está dañado"_). That's expected. The cask tries to clear the quarantine flag on install; if macOS still blocks it, run this once and reopen:

```sh
xattr -dr com.apple.quarantine "/Applications/Ganesha.app"
```

> The right-click → **Open** trick does _not_ clear the "damaged" variant on Apple Silicon — only the command above does. (Proper signing + notarization, which removes this entirely, is staged for when an Apple Developer account is available.)

Update later with `brew upgrade --cask ganesha`. The cask serves the right build for Apple Silicon or Intel automatically.

### Direct download

Download the latest build for your platform from the [**Releases**](https://github.com/JonathanAriass/Ganesha/releases) page:

| Platform | Artifact |
|---|---|
| macOS (Apple Silicon) | `.zip` (unzip → drag `Ganesha.app` to Applications) |
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
npm test                  # 1012 unit tests (Vitest, Node ABI)
npm run test:integration  # 47 tests vs real Postgres/MySQL/Mongo + an SSH tunnel (testcontainers, needs Docker)
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
│   ├── llm/         # on-device GGUF assistant (node-llama-cpp), schema + linked-repo grounding
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
- Credentials never leave the main process in a plaintext-readable form. The one way out is an export you explicitly opt into, where the main process encrypts them with your passphrase before writing the file — the renderer never sees them.

Found a security issue? Please open a private report rather than a public issue (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Contributing

Contributions are welcome — see [**CONTRIBUTING.md**](CONTRIBUTING.md) for the dev setup, the quality gates every change must pass, and how the project is structured.

## License

[MIT](LICENSE) © [JonathanAriass](https://github.com/JonathanAriass)

## Acknowledgments

Built on the shoulders of [Electron](https://www.electronjs.org/), [electron-vite](https://electron-vite.org/), [React](https://react.dev/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [TanStack Table & Virtual](https://tanstack.com/), [node-llama-cpp](https://node-llama-cpp.withcat.ai/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), and the official `pg`, `mysql2` and `mongodb` drivers.
