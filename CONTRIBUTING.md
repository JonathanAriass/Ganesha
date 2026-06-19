# Contributing to Ganesha

Thanks for your interest in improving Ganesha! This guide covers the dev setup, the
quality bar every change has to clear, and how the project is laid out.

## Getting set up

Prerequisites: **Node 20+** and npm. Docker is only needed for the integration tests.

```bash
git clone https://github.com/JonathanAriass/Ganesha.git
cd Ganesha
npm install        # also rebuilds better-sqlite3 for Electron (postinstall)
npm run dev        # launch the app with hot reload
```

## Quality gates

Every change must pass these before it's merged — CI runs the first three on every push:

```bash
npm run typecheck          # tsc, both the node and web projects
npm run lint               # ESLint + Prettier
npm test                   # Vitest unit tests (Node ABI)
npm run test:integration   # real Postgres/MySQL/Mongo + an SSH tunnel (testcontainers, needs Docker)
```

Run the integration suite when you touch a driver, the query pipeline, persistence, or the
SSH tunnel — it spins up real databases in Docker via testcontainers. Pure renderer or
docs changes don't need it.

## How we work

- **Tests come with the change.** New logic ships with unit tests; prefer extracting pure
  functions (see `src/renderer/src/lib/` and `src/shared/`) so behavior is testable without
  a running Electron or a real database. Bug fixes start with a failing test.
- **Keep PRs focused.** One feature or fix per branch. No drive-by refactors mixed into a
  feature — they're hard to review and to revert.
- **Conventional commits.** Messages read `feat: …`, `fix: …`, `docs: …`, `chore: …`,
  `refactor: …`. Keep the subject in the imperative and explain the *why* in the body.
- **Design notes.** Larger features are designed before they're built; the specs and
  per-feature implementation plans live in [`docs/superpowers/`](docs/superpowers/) and are
  a good model for how a change is scoped.

## Project layout

See the [Architecture](README.md#architecture) section of the README for the directory map.
A few invariants worth knowing before you start:

- **The renderer never imports from `src/main`.** A lint rule enforces it. They communicate
  only through the typed IPC contract in `src/shared/ipc.ts`, where every handler returns a
  `Result<T>` envelope.
- **Secrets are write-only from the renderer.** Passwords and SSH secrets are encrypted with
  the OS keychain in the main process; there is no IPC channel that reads one back. Don't add
  one.
- **Read-only mode is double-guarded.** SQL goes through a statement guard *and* a server-side
  read-only transaction; Mongo through a command allow-list. Keep both paths intact.
- **`src/shared` has no runtime dependencies** — it's the contract shared by main and renderer.

## Reporting bugs & requesting features

Open an issue with clear reproduction steps (engine, OS, what you ran, what you expected vs.
saw). Screenshots help for UI issues.

## Security

If you find a security vulnerability, please **report it privately** to the maintainer rather
than opening a public issue, so it can be fixed before disclosure.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
