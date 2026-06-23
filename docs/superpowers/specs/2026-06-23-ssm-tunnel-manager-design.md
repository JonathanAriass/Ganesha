# SSM tunnel manager — design

**Goal:** Manage AWS SSM port-forwarding tunnels inside Ganesha — start/stop them, watch their live
output, track which are running, and offer to start a connection's linked tunnel when it's down.
Replaces the external `ssm-db-tunnel` bash script (which forwards `127.0.0.1:13306 → RDS:3306`).

## Decisions (from brainstorming)

- **SSM-tunnel manager** (purpose-built, not a generic runner) in a **dockable panel**.
- **Link tunnels to connections** and **offer to start** a down tunnel.
- Ships **empty** — the user adds tunnels; real instance ids / profile live only in the local sqlite
  (the Ganesha repo is public, so no infra in committed source).

## Data model (`shared/domain.ts`)

```ts
export interface SsmTunnelInput {
  name: string; profile: string; region: string; instanceId: string
  remotePort: number; localPort: number
  connectionId: string | null   // optional DB connection this tunnel serves
}
export interface SsmTunnel extends SsmTunnelInput { id: string; createdAt: number; updatedAt: number }
```

Persisted in a new `ssm_tunnels` table (FK `connection_id` → connections, ON DELETE SET NULL so
deleting a connection only unlinks). CRUD in `persistence/ssm-tunnels.ts` (connections.ts idiom).

## Process runner (`main/ssm/runner.ts`)

- Pure `buildSsmArgs(tunnel): string[]` → the `aws` argv:
  `ssm start-session --profile … --region … --target <instanceId> --document-name
  AWS-StartPortForwardingSession --parameters {"portNumber":["<remote>"],"localPortNumber":["<local>"]}`.
  (`--parameters` is one argv element — no shell, no escaping.)
- `resolveUserPath()` — once, run `$SHELL -ilc 'echo …$PATH…'` (markers to skip shell noise) and cache,
  because a macOS GUI app doesn't inherit the shell `PATH` (so `aws` wouldn't resolve otherwise).
- `SsmRunner`: `start(tunnel)` spawns `aws` directly (args array, `env.PATH` = resolved, `detached:true`
  so it leads a process group), streams stdout/stderr via an `onOutput(id, chunk)` callback, and on
  exit fires `onStatus(id, {running:false, code})`. `stop(id)` kills the **group** (`process.kill(-pid)`)
  so the session-manager-plugin child dies too. Tracks running children by tunnel id; `running()` lists them.
- `stopAll()` on quit.

## IPC

- `ssm.list` / `ssm.create` / `ssm.update` / `ssm.delete` (CRUD).
- `ssm.start` (id) / `ssm.stop` (id) / `ssm.running` (→ running ids).
- Push: `ssm:output` `{ id, chunk }`, `ssm:status` `{ id, running, code? }`.

## Renderer

- Dockable `SsmPanel.tsx` (the assistant-panel pattern): a tunnel list (status dot, Start/Stop,
  `127.0.0.1:<local> → <name>`), the selected tunnel's live **output** pane, and an **add/edit** form
  (name, profile, region, instance id, remote/local port, optional connection). TopBar toggle button.
- Store: `useSsmTunnels` (TanStack), a subscription to `ssm:status`/`ssm:output` keeping a `Set<runningId>`
  + per-tunnel output buffers; `ssm.running` seeds the set on mount.
- **Connect-time offer:** a banner when the **active connection** has a linked tunnel that isn't running
  — `⚠ Tunnel '<name>' is not running [Start]`. (A banner, not a hard connect-interception — connections
  dial lazily; this is reactive to active-connection + running set.)

## Prerequisites (surfaced, not enforced)

The AWS CLI + Session Manager plugin installed and a valid `aws sso login` for the profile. The app runs
the command and shows aws's own stderr (e.g. "not logged in"); the user fixes creds in their terminal.

## Testing

Pure-unit: `buildSsmArgs` (argv shape, parameters JSON, port stringify) and `ssm-tunnels.ts` CRUD
(round-trip, connection unlink on delete). The spawn/stream/kill runner is verified live (real `aws`).
Renderer libs (running-set reducer, banner predicate) unit-tested; panel verified live.

## Out of scope (v1)

Generic non-SSM script running, editing AWS creds/SSO from the app, importing the bash script, multiple
windows of output history, auto-restart on drop.
