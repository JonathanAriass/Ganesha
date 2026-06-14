# SSH Tunnel for Database Connections — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming) — ready for implementation plan
**Goal:** Let a connection reach its database through one or more SSH hops (jump-server chain), configured per connection in the UI, the way DBeaver's SSH tab works.

---

## Motivation

Databases on private subnets (e.g. an AWS RDS/EC2 instance reachable only via a
bastion host) can't be reached directly. The user needs to describe an SSH
tunnel — a chain of SSH hops — so the client connects through them. Reference:
DBeaver's "SSH" connection tab with a "Jump servers" chain (bastion 35.180.x →
target 10.0.3.202 → DB).

## Approved scope

- **Jump-server chain of any depth.** `hops[0]` is the first SSH server reached
  from this machine; the DB host/port (from the Main connection form) is the
  final forward target, reached from the last hop.
- **Auth per hop: private key (+ passphrase) or password.** No SSH agent (v1).
- **Private key referenced by file path** (read at connect time), like DBeaver.
  Only the passphrase/password are secrets.
- **Host-key verification: accept any host key in v1** (frictionless), documented
  as a known limitation. `~/.ssh/known_hosts` (TOFU) verification is a follow-up.

### Non-goals (v1, YAGNI)

- Reusable SSH profiles shared across connections — per-connection config only.
- SSH agent / `SSH_AUTH_SOCK` auth.
- Advanced knobs (compression, keepalive intervals, custom local bind) — defaults only.
- Two-hop integration test in CI — multi-hop is covered by unit tests; integration
  proves a single real hop.

---

## Architecture: tunnel lives in `main`, drivers stay blind

A new `SshTunnelManager` (main process) owns tunnel lifecycles keyed by
connection id. Before any `driver.connect(params)` / `driver.testConnection(params)`,
if the connection has SSH enabled, the manager establishes the hop chain, starts
a local `127.0.0.1:<ephemeral>` TCP forwarder, and returns that local endpoint.
Main rewrites `ConnectParams.host`/`port` to the local endpoint and calls the
driver unchanged. **Drivers never learn SSH exists** — this works identically for
postgres, mysql, mariadb and mongodb because they all go through `ConnectParams`.

Rejected alternatives:
- **Driver-level SSH** (each driver opens its own tunnel): triples the `ssh2`
  wiring and the test surface.
- **Native per-library SSH:** pg/mysql/mongo have no uniform SSH support (mongo
  has none).

### How the chain is built (using `ssh2`)

1. TCP-connect an `ssh2.Client` to `hops[0]`, authenticate.
2. For each subsequent hop `i`: call `prevClient.forwardOut('127.0.0.1', 0,
   hops[i].host, hops[i].port)` to get a stream, then create a new `ssh2.Client`
   with `{ sock: stream }` and authenticate to `hops[i]`.
3. After the last hop authenticates, start a local `net.Server` on `127.0.0.1:0`.
   On each incoming socket, call `lastClient.forwardOut('127.0.0.1', 0, dbHost,
   dbPort)` and pipe socket ↔ stream both ways.
4. Resolve `{ host: '127.0.0.1', port: server.address().port }`.

Idempotent per connection id: a second `open()` for an already-open tunnel
returns the existing local endpoint.

---

## Data model

`src/shared/domain.ts`:

```ts
export interface SshHop {
  id: string                       // stable uuid; secrets are keyed by it so reorders don't scramble them
  host: string
  port: number                     // default 22
  username: string
  auth: 'key' | 'password'
  keyPath: string                  // used when auth === 'key' ('' otherwise)
  // passphrase / password are NOT stored here — they are secrets
}

export interface SshConfig {
  enabled: boolean
  hops: SshHop[]                   // ordered; hops[0] is the first hop from this machine
}
```

Add to `ConnectionInput` (and therefore `ConnectionConfig`):

```ts
  ssh: SshConfig | null            // null = never configured; { enabled:false } = configured but off
```

## Persistence + migration

`connections` table gains a nullable `ssh_json TEXT` column holding
`JSON.stringify(SshConfig)` (or NULL). The nested hop array doesn't fit flat
columns; a JSON column keeps it cohesive. `connections.ts` serializes on
write and parses on read (tolerating NULL → `ssh: null`). Schema migration adds
the column if absent (additive; existing rows read back `ssh: null`).

## Secrets

The `secrets` table key widens from `connection_id` to the composite
`(connection_id, secret_key)`:

- `secret_key = 'db'` — the database password (existing behavior).
- `secret_key = 'ssh:<hopId>'` — that hop's passphrase (key auth) or password
  (password auth).

Migration: existing rows get `secret_key = 'db'`. The `secrets.ts` store API
gains a `key` parameter (default `'db'` for back-compat at call sites that only
deal with the DB password). A `deleteSecretsFor(connectionId)` clears all of a
connection's secrets on delete.

**Write-only from the renderer, unchanged rule:** the modal sends SSH
passphrases/passwords only on save; blank-on-edit = keep existing; they are
resolved server-side at connect time. **No getSecret channel, ever.** Keying by
hop **id** means reordering hops in the UI doesn't mismatch passphrases.

## IPC

- The existing `connections.create` / `connections.update` requests carry the
  new `ssh` config (in `input`/`patch`) plus a **map of SSH secrets** to write
  (`{ [hopId]: string }`, only the ones the user typed). The handlers persist
  the config and write the typed SSH secrets alongside the DB password, using
  the same write-only / keep-existing semantics.
- `connections.test` carries `ssh` + typed SSH secrets so Test exercises the
  real tunnel; unentered secrets fall back to stored ones (edit mode), mirroring
  `resolveTestPassword`.
- **New channel `dialog.openFile`** — opens an Electron open-file dialog, returns
  the chosen path (or null). Used by the key-path picker. (+1 IPC channel.)

## Connect / disconnect wiring

Today several sites call `driver.connect(buildConnectParams(config, password))`
(`query-service.ts`, the `schema.*` handlers) and `driver.disconnect(id)`
(`connections.update` / `.delete` / `.disconnect`). These centralize into two
helpers in main:

- `connectVia(driver, config, secrets, tunnels)`: if `config.ssh?.enabled`,
  resolve hop secrets, `tunnels.open(...)` → local endpoint, build params with
  the rewritten host/port, then `driver.connect(params)`. Otherwise the current
  direct path.
- `disconnectVia(driver, config|id, tunnels)`: `driver.disconnect(id)` then
  `tunnels.close(id)`.

App quit closes all tunnels (`tunnels.closeAll()`), alongside existing pool
teardown.

## Error surfacing

`SshTunnelManager` throws prefixed, hop-numbered errors so SSH failures are
distinct from DB errors in the modal's Test and in query/connect paths:

- `SSH tunnel: key file not found: /Users/…/aws_2024.pem`
- `SSH tunnel: authentication failed at hop 1 (35.180.247.138)`
- `SSH tunnel: hop 2 (10.0.3.202:22) unreachable: <cause>`

## UI — new "SSH" section in `ConnectionModal`

Mirrors the DBeaver screenshot:

- **Enable SSH tunnel** checkbox. When off, the hop editor is disabled but the
  typed config is retained (`{ enabled:false, hops:[…] }`).
- An ordered **hop list** with add / remove / move-up / move-down. Each hop row:
  - Host, Port (default 22), Username
  - Auth method select: **Key** | **Password**
  - Key: a **key-path field with a "Browse…" button** (calls `dialog.openFile`)
    + a Passphrase field. Password: a Password field.
- The DB host/port stay on the Main form (they are the final forward target).
- Secret fields follow the existing write-only convention: placeholder indicates
  a stored secret in edit mode; left blank = keep existing.

## Testing

**Unit (pure libs, vitest — repo convention is logic-in-libs, no component tests):**
- `lib/ssh-config.ts`: validation/normalization (port default, trim, require ≥1
  hop when enabled, require keyPath for key auth), and which hops still need a
  secret. Tested directly.
- Secret-keying (`'db'` vs `'ssh:<id>'`), back-compat default, delete-all-for.
- Connect-params host/port rewriting given a tunnel endpoint.
- Chain-building order + error formatting against an **injectable mock `ssh2`**
  (the manager takes its `ssh2.Client` factory as a dependency), including
  multi-hop ordering and each failure path's message.

**Integration (testcontainers, Docker — required because the connection path
changes):**
- A real `sshd` container (e.g. an OpenSSH server image) with a known key,
  forwarding to the demo Postgres container; assert a query succeeds **through
  the tunnel** end-to-end (single hop). Validates the `forwardOut` + local
  server plumbing against real `ssh2`.

## File structure

- `src/shared/domain.ts` — `SshHop`, `SshConfig`, `ConnectionInput.ssh`.
- `src/main/ssh/tunnel-manager.ts` — `SshTunnelManager` (open/close/closeAll),
  ssh2 factory injectable.
- `src/main/ssh/chain.ts` (or within the manager) — pure chain-build sequence.
- `src/renderer/src/lib/ssh-config.ts` — pure validation/normalization + helpers.
- `src/main/persistence/secrets.ts` — composite-key secret store.
- `src/main/persistence/connections.ts` — `ssh_json` (de)serialization + migration.
- `src/main/persistence/db.ts` — schema migration (add `ssh_json`, widen secrets PK).
- `src/main/ipc.ts` — `dialog.openFile`; connect/disconnect via helpers; carry SSH
  config + secrets through create/update/test.
- `src/main/drivers/params.ts` — params build accepting an override host/port.
- `src/renderer/src/components/ConnectionModal.tsx` — SSH section + hop editor.
- `src/shared/ipc.ts` — `dialog.openFile` channel types; request shapes updated.
- New dep: `ssh2` (+ `@types/ssh2`).

## Open follow-ups (post-v1)

- `known_hosts` (TOFU) host-key verification with an unknown-host prompt.
- SSH agent auth.
- Reusable SSH profiles.
- Two-hop integration test.
