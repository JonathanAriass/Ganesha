# SSH Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a connection reach its database through an ordered chain of SSH hops (jump servers), configured per connection in the UI.

**Architecture:** An `SshTunnelManager` in the main process opens the SSH hop chain with `ssh2`, starts a local `127.0.0.1:<ephemeral>` forwarder, and returns that endpoint. Main rewrites `ConnectParams.host/port` to the local endpoint, so the existing drivers connect through the tunnel without knowing it exists. SSH config persists as a JSON column; passphrases/passwords persist in a widened (composite-key) secret store, write-only from the renderer.

**Tech Stack:** Electron + React + TypeScript, electron-vite, better-sqlite3, `ssh2` (new), vitest, testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-14-ssh-tunnel-design.md`

---

## Canonical signatures (use these names verbatim across tasks)

```ts
// src/shared/domain.ts
interface SshHop { id: string; host: string; port: number; username: string; auth: 'key' | 'password'; keyPath: string }
interface SshConfig { enabled: boolean; hops: SshHop[] }
// ConnectionInput gains:  ssh: SshConfig | null

// src/renderer/src/lib/ssh-config.ts (pure)
emptyHop(id: string): SshHop
normalizeSshConfig(ssh: SshConfig | null): SshConfig | null
validateSshConfig(ssh: SshConfig | null): string | null   // null = valid

// src/main/persistence/secrets.ts (store gains composite-key methods; old names kept as 'db' wrappers)
setSecret(connectionId, key, value): void
getSecret(connectionId, key): string | null
deleteSecret(connectionId, key): void
deleteAllSecrets(connectionId): void
setPassword/getPassword/deletePassword  // thin wrappers over key 'db'
// hop secret key convention:  `ssh:${hop.id}`

// src/main/ssh/auth.ts (pure)
interface ResolvedHop { host: string; port: number; username: string; auth: 'key' | 'password'; privateKey?: Buffer; passphrase?: string; password?: string }
resolveHop(hop: SshHop, secret: string | null, readFile: (p: string) => Buffer): ResolvedHop

// src/main/ssh/tunnel-manager.ts
interface TunnelEndpoint { host: string; port: number }
class SshTunnelManager {
  constructor(deps?: { createClient?: () => SshClientLike })
  open(connId: string, hops: ResolvedHop[], dbHost: string, dbPort: number): Promise<TunnelEndpoint>
  close(connId: string): Promise<void>
  closeAll(): Promise<void>
}

// src/main/drivers/params.ts
buildConnectParams(config, password, override?: { host: string; port: number }): ConnectParams

// src/main/connection-runtime.ts
interface ConnectDeps { tunnels: SshTunnelManager; readFile: (p: string) => Buffer; getHopSecret: (hopId: string) => string | null; dbPassword: string | null }
connectVia(driver, config: ConnectionConfig, deps: ConnectDeps): Promise<void>
disconnectVia(driver, config: ConnectionConfig, tunnels: SshTunnelManager): Promise<void>
```

---

### Task 1: Shared types + `ssh2` dependency

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `package.json` (deps)

- [ ] **Step 1: Add the dependency**

Run: `npm i ssh2 && npm i -D @types/ssh2`
Expected: both install; `ssh2` appears under `dependencies`, `@types/ssh2` under `devDependencies`.

- [ ] **Step 2: Add the SSH types and the `ssh` field**

In `src/shared/domain.ts`, add above `ConnectionInput`:

```ts
/** One SSH hop in a tunnel chain. hops[0] is the first server reached from this
 *  machine; the DB host/port is the final forward target, reached from the last hop. */
export interface SshHop {
  /** Stable id; secrets are keyed by it so reordering hops never scrambles them. */
  id: string
  host: string
  port: number
  username: string
  auth: 'key' | 'password'
  /** Path to the private key file when auth === 'key'; '' otherwise. */
  keyPath: string
}

/** SSH tunnel config for a connection. enabled=false keeps the typed hops but skips the tunnel. */
export interface SshConfig {
  enabled: boolean
  hops: SshHop[]
}
```

Then add to `ConnectionInput` (after `replicaSet`):

```ts
  /** SSH tunnel; null = never configured. */
  ssh: SshConfig | null
```

- [ ] **Step 3: Fix every `ConnectionInput` literal**

Run: `npm run typecheck 2>&1 | grep -i "ssh\|ConnectionInput" | head`
Expected: errors at each `ConnectionInput` literal missing `ssh`. Add `ssh: null,` to each. Known locations: `src/main/persistence/secrets.test.ts`, `src/main/persistence/connections.test.ts`, `src/renderer/src/components/ConnectionModal.tsx` (`DEFAULT_INPUT`), and any other literal the compiler flags. Re-run until clean.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/shared/domain.ts src/main/persistence/secrets.test.ts src/main/persistence/connections.test.ts src/renderer/src/components/ConnectionModal.tsx
git commit -m "feat: ssh2 dep + SshHop/SshConfig types + ConnectionInput.ssh"
```

---

### Task 2: Pure SSH-config lib (validation/normalization)

**Files:**
- Create: `src/renderer/src/lib/ssh-config.ts`
- Test: `src/renderer/src/lib/ssh-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { emptyHop, normalizeSshConfig, validateSshConfig } from './ssh-config'
import type { SshConfig } from '@shared/domain'

const hop = (over: Partial<ReturnType<typeof emptyHop>> = {}) => ({ ...emptyHop('h1'), ...over })

describe('emptyHop', () => {
  it('defaults port 22, key auth, empty strings', () => {
    expect(emptyHop('h1')).toEqual({ id: 'h1', host: '', port: 22, username: '', auth: 'key', keyPath: '' })
  })
})

describe('normalizeSshConfig', () => {
  it('passes null through', () => {
    expect(normalizeSshConfig(null)).toBeNull()
  })
  it('trims host/username/keyPath and coerces a blank port to 22', () => {
    const cfg: SshConfig = { enabled: true, hops: [hop({ host: ' bastion ', username: ' ec2-user ', keyPath: ' /k.pem ', port: 0 })] }
    expect(normalizeSshConfig(cfg)).toEqual({
      enabled: true,
      hops: [{ id: 'h1', host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', keyPath: '/k.pem' }]
    })
  })
})

describe('validateSshConfig', () => {
  it('null and disabled are valid', () => {
    expect(validateSshConfig(null)).toBeNull()
    expect(validateSshConfig({ enabled: false, hops: [] })).toBeNull()
  })
  it('enabled requires at least one hop', () => {
    expect(validateSshConfig({ enabled: true, hops: [] })).toMatch(/at least one hop/i)
  })
  it('requires host, username, valid port per hop', () => {
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: '' })] })).toMatch(/host/i)
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: '' })] })).toMatch(/username/i)
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: 'u', port: 70000 })] })).toMatch(/port/i)
  })
  it('key auth requires a key path', () => {
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: 'u', auth: 'key', keyPath: '' })] })).toMatch(/key file/i)
  })
  it('a fully specified key hop is valid', () => {
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: 'u', keyPath: '/k.pem' })] })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run src/renderer/src/lib/ssh-config.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { SshConfig, SshHop } from '@shared/domain'

export function emptyHop(id: string): SshHop {
  return { id, host: '', port: 22, username: '', auth: 'key', keyPath: '' }
}

export function normalizeSshConfig(ssh: SshConfig | null): SshConfig | null {
  if (ssh === null) return null
  return {
    enabled: ssh.enabled,
    hops: ssh.hops.map((h) => ({
      id: h.id,
      host: h.host.trim(),
      port: Number.isInteger(h.port) && h.port >= 1 && h.port <= 65535 ? h.port : 22,
      username: h.username.trim(),
      auth: h.auth,
      keyPath: h.keyPath.trim()
    }))
  }
}

/** Structural validation only — secret presence is resolved in main (stored
 *  secrets aren't visible to the renderer, so we can't require them here). */
export function validateSshConfig(ssh: SshConfig | null): string | null {
  if (ssh === null || !ssh.enabled) return null
  if (ssh.hops.length === 0) return 'Enable SSH tunnel: add at least one hop.'
  for (let i = 0; i < ssh.hops.length; i++) {
    const h = ssh.hops[i]
    const where = `hop ${i + 1}`
    if (!h.host.trim()) return `SSH ${where}: host is required.`
    if (!h.username.trim()) return `SSH ${where}: username is required.`
    if (!Number.isInteger(h.port) || h.port < 1 || h.port > 65535) return `SSH ${where}: port must be 1–65535.`
    if (h.auth === 'key' && !h.keyPath.trim()) return `SSH ${where}: a key file is required for key auth.`
  }
  return null
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/renderer/src/lib/ssh-config.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/ssh-config.ts src/renderer/src/lib/ssh-config.test.ts
git commit -m "feat: pure SSH config validation/normalization lib"
```

---

### Task 3: Persist `ssh` as a JSON column on connections

**Files:**
- Modify: `src/main/persistence/db.ts` (CREATE TABLE + `addColumnIfMissing`)
- Modify: `src/main/persistence/connections.ts` (row mapping + writes)
- Test: `src/main/persistence/connections.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/main/persistence/connections.test.ts` (it already imports `migrate`, `createConnection`, `getConnection`, `updateConnection` and an `input` literal — reuse them; add `ssh` to the literal if not already):

```ts
import type { SshConfig } from '../../shared/domain'

const ssh: SshConfig = {
  enabled: true,
  hops: [{ id: 'h1', host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', keyPath: '/k.pem' }]
}

describe('ssh config persistence', () => {
  it('defaults to null when never set', () => {
    const c = createConnection(db, { ...input, ssh: null }, 1)
    expect(getConnection(db, c.id)!.ssh).toBeNull()
  })
  it('round-trips an SSH chain through create', () => {
    const c = createConnection(db, { ...input, ssh }, 1)
    expect(getConnection(db, c.id)!.ssh).toEqual(ssh)
  })
  it('updates the SSH config', () => {
    const c = createConnection(db, { ...input, ssh: null }, 1)
    updateConnection(db, c.id, { ssh }, 2)
    expect(getConnection(db, c.id)!.ssh).toEqual(ssh)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/persistence/connections.test.ts`
Expected: FAIL (`ssh` undefined on the returned config / column missing).

- [ ] **Step 3: Implement — schema**

In `src/main/persistence/db.ts`, add `ssh_json TEXT` to the `connections` CREATE TABLE (after `replica_set`):

```sql
      replica_set TEXT NOT NULL DEFAULT '',
      ssh_json    TEXT,
```

And add a migration line next to the existing `addColumnIfMissing` calls:

```ts
  addColumnIfMissing(db, 'connections', 'ssh_json', 'TEXT')
```

- [ ] **Step 4: Implement — mapping**

In `src/main/persistence/connections.ts`:

Add `ssh_json: string | null` to the `Row` interface. In `toConfig`, parse it:

```ts
    authSource: r.auth_source, replicaSet: r.replica_set,
    ssh: r.ssh_json ? (JSON.parse(r.ssh_json) as ConnectionConfig['ssh']) : null,
    createdAt: r.created_at, updatedAt: r.updated_at
```

In `createConnection`, add the column + value (serialize):

```ts
  db.prepare(`INSERT INTO connections
    (id,type,name,color,host,port,username,db_name,ssl,read_only,auth_source,replica_set,ssh_json,created_at,updated_at)
    VALUES (@id,@type,@name,@color,@host,@port,@username,@database,@ssl,@readOnly,@authSource,@replicaSet,@ssh_json,@now,@now)`)
    .run({ id, ...input, ssl: input.ssl ? 1 : 0, readOnly: input.readOnly ? 1 : 0, ssh_json: input.ssh ? JSON.stringify(input.ssh) : null, now })
```

In `updateConnection`, add `ssh_json=@ssh_json` to the SET list and the param:

```ts
    auth_source=@authSource,replica_set=@replicaSet,ssh_json=@ssh_json,updated_at=@now WHERE id=@id`)
    .run({ ...next, id, ssl: next.ssl ? 1 : 0, readOnly: next.readOnly ? 1 : 0, ssh_json: next.ssh ? JSON.stringify(next.ssh) : null, now })
```

- [ ] **Step 5: Run — expect pass**

Run: `npx vitest run src/main/persistence/connections.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/persistence/db.ts src/main/persistence/connections.ts src/main/persistence/connections.test.ts
git commit -m "feat: persist SSH config as ssh_json column on connections"
```

---

### Task 4: Composite-key secret store + migration

**Files:**
- Modify: `src/main/persistence/db.ts` (secrets table + rebuild migration)
- Modify: `src/main/persistence/secrets.ts`
- Test: `src/main/persistence/secrets.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/main/persistence/secrets.test.ts`:

```ts
describe('composite-key secrets', () => {
  it('stores/reads/deletes a keyed secret independently of the db password', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'dbpw')
    store.setSecret(c.id, 'ssh:h1', 'passphrase1')
    expect(store.getSecret(c.id, 'ssh:h1')).toBe('passphrase1')
    expect(store.getPassword(c.id)).toBe('dbpw') // untouched
    store.deleteSecret(c.id, 'ssh:h1')
    expect(store.getSecret(c.id, 'ssh:h1')).toBeNull()
    expect(store.getPassword(c.id)).toBe('dbpw')
  })
  it('deleteAllSecrets clears every key for a connection', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'dbpw')
    store.setSecret(c.id, 'ssh:h1', 'p1')
    store.deleteAllSecrets(c.id)
    expect(store.getPassword(c.id)).toBeNull()
    expect(store.getSecret(c.id, 'ssh:h1')).toBeNull()
  })
})

describe('legacy secrets migration', () => {
  it('rebuilds an old single-key secrets table into the composite shape, preserving the db password', () => {
    const legacy = new Database(':memory:')
    legacy.exec(`CREATE TABLE connections (id TEXT PRIMARY KEY, type TEXT, name TEXT, color TEXT, host TEXT, port INTEGER, username TEXT, db_name TEXT, ssl INTEGER, read_only INTEGER, auth_source TEXT, replica_set TEXT, created_at INTEGER, updated_at INTEGER);`)
    legacy.exec(`CREATE TABLE secrets (connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE, ciphertext BLOB NOT NULL);`)
    legacy.prepare(`INSERT INTO connections (id,type,name,color,host,port,username,db_name,ssl,read_only,auth_source,replica_set,created_at,updated_at) VALUES ('c1','postgres','p','#000','h',1,'u','d',0,0,'','',1,1)`).run()
    legacy.prepare(`INSERT INTO secrets (connection_id, ciphertext) VALUES ('c1', ?)`).run(Buffer.from('enc:old', 'utf8'))
    migrate(legacy) // should rebuild
    const s = makeSecretStore(legacy, fake)
    expect(s.getPassword('c1')).toBe('old')
    const cols = legacy.prepare(`SELECT name FROM pragma_table_info('secrets')`).all() as { name: string }[]
    expect(cols.some((c) => c.name === 'secret_key')).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/persistence/secrets.test.ts`
Expected: FAIL (`setSecret` not a function; migration not present).

- [ ] **Step 3: Implement — schema + migration**

In `src/main/persistence/db.ts`, change the `secrets` CREATE TABLE to the composite shape:

```sql
    CREATE TABLE IF NOT EXISTS secrets (
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      secret_key    TEXT NOT NULL DEFAULT 'db',
      ciphertext    BLOB NOT NULL,
      PRIMARY KEY (connection_id, secret_key)
    );
```

Add a rebuild migration function and call it inside `migrate()` after the `addColumnIfMissing` calls:

```ts
/** Old DBs have secrets keyed by connection_id alone. Rebuild into the composite
 *  (connection_id, secret_key) shape, tagging existing rows as the 'db' password. */
function migrateSecretsCompositeKey(db: DB): void {
  const cols = db.prepare(`SELECT name FROM pragma_table_info('secrets')`).all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'secret_key')) return // fresh (composite) or already migrated
  db.exec(`
    CREATE TABLE secrets_new (
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      secret_key    TEXT NOT NULL DEFAULT 'db',
      ciphertext    BLOB NOT NULL,
      PRIMARY KEY (connection_id, secret_key)
    );
    INSERT INTO secrets_new (connection_id, secret_key, ciphertext)
      SELECT connection_id, 'db', ciphertext FROM secrets;
    DROP TABLE secrets;
    ALTER TABLE secrets_new RENAME TO secrets;
  `)
}
```

Call site (end of `migrate()`):

```ts
  addColumnIfMissing(db, 'connections', 'ssh_json', 'TEXT')
  migrateSecretsCompositeKey(db)
```

- [ ] **Step 4: Implement — store API**

Replace the `makeSecretStore` return object in `src/main/persistence/secrets.ts`:

```ts
export function makeSecretStore(db: DB, enc: Encryptor) {
  const setSecret = (connectionId: string, key: string, value: string): void => {
    db.prepare(
      `INSERT INTO secrets (connection_id, secret_key, ciphertext) VALUES (?, ?, ?)
       ON CONFLICT(connection_id, secret_key) DO UPDATE SET ciphertext = excluded.ciphertext`
    ).run(connectionId, key, enc.encrypt(value))
  }
  const getSecret = (connectionId: string, key: string): string | null => {
    const row = db.prepare('SELECT ciphertext FROM secrets WHERE connection_id = ? AND secret_key = ?')
      .get(connectionId, key) as { ciphertext: Buffer } | undefined
    return row ? enc.decrypt(row.ciphertext) : null
  }
  const deleteSecret = (connectionId: string, key: string): void => {
    db.prepare('DELETE FROM secrets WHERE connection_id = ? AND secret_key = ?').run(connectionId, key)
  }
  const deleteAllSecrets = (connectionId: string): void => {
    db.prepare('DELETE FROM secrets WHERE connection_id = ?').run(connectionId)
  }
  return {
    setSecret, getSecret, deleteSecret, deleteAllSecrets,
    setPassword: (id: string, pw: string) => setSecret(id, 'db', pw),
    getPassword: (id: string) => getSecret(id, 'db'),
    deletePassword: (id: string) => deleteSecret(id, 'db')
  }
}
```

(`resolveTestPassword` and `Encryptor`/`safeStorageEncryptor` stay as-is.)

- [ ] **Step 5: Run — expect pass**

Run: `npx vitest run src/main/persistence/secrets.test.ts`
Expected: PASS (including migration).

- [ ] **Step 6: Commit**

```bash
git add src/main/persistence/db.ts src/main/persistence/secrets.ts src/main/persistence/secrets.test.ts
git commit -m "feat: composite-key secret store + legacy rebuild migration"
```

---

### Task 5: Pure SSH hop resolver (`auth.ts`)

**Files:**
- Create: `src/main/ssh/auth.ts`
- Test: `src/main/ssh/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveHop } from './auth'
import type { SshHop } from '../../shared/domain'

const keyHop: SshHop = { id: 'h1', host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', keyPath: '/k.pem' }
const pwHop: SshHop = { id: 'h2', host: 'target', port: 2222, username: 'root', auth: 'password', keyPath: '' }

describe('resolveHop', () => {
  it('reads the key file and attaches passphrase for key auth', () => {
    const r = resolveHop(keyHop, 'phrase', () => Buffer.from('KEYDATA'))
    expect(r).toEqual({ host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', privateKey: Buffer.from('KEYDATA'), passphrase: 'phrase' })
  })
  it('omits passphrase when none is stored (unencrypted key)', () => {
    const r = resolveHop(keyHop, null, () => Buffer.from('KEYDATA'))
    expect(r.passphrase).toBeUndefined()
    expect(r.privateKey).toEqual(Buffer.from('KEYDATA'))
  })
  it('throws a prefixed error when the key file is unreadable', () => {
    expect(() => resolveHop(keyHop, null, () => { throw new Error('ENOENT') }))
      .toThrow(/SSH tunnel: key file not found: \/k\.pem/)
  })
  it('uses the stored password for password auth, never reads a file', () => {
    let read = false
    const r = resolveHop(pwHop, 'secretpw', () => { read = true; return Buffer.from('') })
    expect(read).toBe(false)
    expect(r).toEqual({ host: 'target', port: 2222, username: 'root', auth: 'password', password: 'secretpw' })
  })
  it('throws when password auth has no password', () => {
    expect(() => resolveHop(pwHop, null, () => Buffer.from('')))
      .toThrow(/SSH tunnel: password required for hop target/)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/ssh/auth.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { SshHop } from '../../shared/domain'

export interface ResolvedHop {
  host: string
  port: number
  username: string
  auth: 'key' | 'password'
  privateKey?: Buffer
  passphrase?: string
  password?: string
}

/** Turn a stored hop + its secret into the concrete auth material ssh2 needs.
 *  readFile is injected (fs.readFileSync in production) so this stays pure/testable. */
export function resolveHop(hop: SshHop, secret: string | null, readFile: (p: string) => Buffer): ResolvedHop {
  const base = { host: hop.host, port: hop.port, username: hop.username, auth: hop.auth }
  if (hop.auth === 'key') {
    let privateKey: Buffer
    try {
      privateKey = readFile(hop.keyPath)
    } catch {
      throw new Error(`SSH tunnel: key file not found: ${hop.keyPath}`)
    }
    return secret ? { ...base, privateKey, passphrase: secret } : { ...base, privateKey }
  }
  if (!secret) throw new Error(`SSH tunnel: password required for hop ${hop.host}`)
  return { ...base, password: secret }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/main/ssh/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ssh/auth.ts src/main/ssh/auth.test.ts
git commit -m "feat: pure SSH hop resolver (key/password auth material)"
```

---

### Task 6: SSH tunnel manager (chain dial, injectable client)

**Files:**
- Create: `src/main/ssh/tunnel-manager.ts`
- Test: `src/main/ssh/tunnel-manager.test.ts`

The manager dials each hop in order. For hops after the first it tunnels through the previous client's `forwardOut`. After the last hop authenticates it starts a local `net.Server` that forwards each socket to the DB host:port. Unit tests inject a fake client to assert **dial order** and **error formatting**; the real `forwardOut`/server piping is proven by the integration test (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { SshTunnelManager, type SshClientLike } from './tunnel-manager'
import type { ResolvedHop } from './auth'

/** A fake ssh2 client recording connects + forwardOut targets. */
function fakeClientFactory(opts: { failAuthAt?: number } = {}) {
  const events: string[] = []
  let n = 0
  const make = (): SshClientLike => {
    const idx = n++
    const handlers: Record<string, ((arg?: unknown) => void)[]> = {}
    return {
      on(ev, cb) { (handlers[ev] ??= []).push(cb as () => void); return this },
      connect(cfg: { host: string }) {
        events.push(`connect#${idx}:${cfg.host}`)
        queueMicrotask(() => {
          if (opts.failAuthAt === idx) handlers['error']?.forEach((h) => h(new Error('auth')))
          else handlers['ready']?.forEach((h) => h())
        })
      },
      forwardOut(_sh, _sp, dh: string, dp: number, cb: (e: Error | null, s?: unknown) => void) {
        events.push(`forward#${idx}->${dh}:${dp}`)
        cb(null, { on() {}, write() {}, end() {}, pipe() {} })
      },
      end() { events.push(`end#${idx}`) }
    }
  }
  return { make, events }
}

const hops = (n: number): ResolvedHop[] =>
  Array.from({ length: n }, (_, i) => ({ host: `h${i}`, port: 22, username: 'u', auth: 'password' as const, password: 'p' }))

describe('SshTunnelManager', () => {
  it('dials hops in order, the next hop tunneled through the previous, then forwards to the DB', async () => {
    const f = fakeClientFactory()
    const mgr = new SshTunnelManager({ createClient: f.make })
    const ep = await mgr.open('c1', hops(2), 'db.internal', 5432)
    expect(ep.host).toBe('127.0.0.1')
    expect(ep.port).toBeGreaterThan(0)
    // hop0 connects; hop1 reached via forwardOut on client0; DB forward issued on client1.
    expect(f.events).toEqual(['connect#0:h0', 'forward#0->h1:22', 'connect#1:h1'])
    await mgr.close('c1')
  })

  it('open is idempotent per connection id', async () => {
    const f = fakeClientFactory()
    const mgr = new SshTunnelManager({ createClient: f.make })
    const a = await mgr.open('c1', hops(1), 'db', 5432)
    const b = await mgr.open('c1', hops(1), 'db', 5432)
    expect(a.port).toBe(b.port)
    expect(f.events.filter((e) => e.startsWith('connect')).length).toBe(1)
    await mgr.close('c1')
  })

  it('surfaces a hop auth failure with its index', async () => {
    const f = fakeClientFactory({ failAuthAt: 1 })
    const mgr = new SshTunnelManager({ createClient: f.make })
    await expect(mgr.open('c1', hops(2), 'db', 5432)).rejects.toThrow(/SSH tunnel: authentication failed at hop 2 \(h1\)/)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/ssh/tunnel-manager.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import net from 'net'
import { Client as Ssh2Client } from 'ssh2'
import type { ResolvedHop } from './auth'

export interface TunnelEndpoint { host: string; port: number }

/** The slice of ssh2.Client this manager uses — narrowed so tests can fake it. */
export interface SshClientLike {
  on(event: string, cb: (arg?: unknown) => void): this
  connect(cfg: Record<string, unknown>): void
  forwardOut(srcHost: string, srcPort: number, dstHost: string, dstPort: number,
             cb: (err: Error | null, stream?: NodeJS.ReadWriteStream) => void): void
  end(): void
}

interface LiveTunnel { clients: SshClientLike[]; server: net.Server; endpoint: TunnelEndpoint }

function connectConfig(hop: ResolvedHop, sock?: NodeJS.ReadWriteStream): Record<string, unknown> {
  const cfg: Record<string, unknown> = { host: hop.host, port: hop.port, username: hop.username }
  if (sock) cfg.sock = sock
  if (hop.auth === 'key') { cfg.privateKey = hop.privateKey; if (hop.passphrase) cfg.passphrase = hop.passphrase }
  else cfg.password = hop.password
  return cfg
}

/** Dial one ssh2 client and resolve when authenticated (or reject with a hop-tagged error). */
function dial(make: () => SshClientLike, hop: ResolvedHop, index: number, sock?: NodeJS.ReadWriteStream): Promise<SshClientLike> {
  return new Promise((resolve, reject) => {
    const client = make()
    client.on('ready', () => resolve(client))
    client.on('error', () => reject(new Error(`SSH tunnel: authentication failed at hop ${index + 1} (${hop.host})`)))
    client.connect(connectConfig(hop, sock))
  })
}

/** forwardOut as a promise. */
function forward(client: SshClientLike, dstHost: string, dstPort: number): Promise<NodeJS.ReadWriteStream> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
      if (err || !stream) reject(new Error(`SSH tunnel: hop unreachable: ${dstHost}:${dstPort}`))
      else resolve(stream)
    })
  })
}

export class SshTunnelManager {
  private tunnels = new Map<string, LiveTunnel>()
  private make: () => SshClientLike

  constructor(deps?: { createClient?: () => SshClientLike }) {
    this.make = deps?.createClient ?? (() => new Ssh2Client() as unknown as SshClientLike)
  }

  async open(connId: string, hops: ResolvedHop[], dbHost: string, dbPort: number): Promise<TunnelEndpoint> {
    const existing = this.tunnels.get(connId)
    if (existing) return existing.endpoint
    if (hops.length === 0) throw new Error('SSH tunnel: no hops configured')

    const clients: SshClientLike[] = []
    try {
      // Dial hop 0 directly; each subsequent hop through the previous client's forwardOut.
      clients.push(await dial(this.make, hops[0], 0))
      for (let i = 1; i < hops.length; i++) {
        const stream = await forward(clients[i - 1], hops[i].host, hops[i].port)
        clients.push(await dial(this.make, hops[i], i, stream))
      }
    } catch (e) {
      clients.forEach((c) => c.end())
      throw e
    }

    const last = clients[clients.length - 1]
    const server = net.createServer((socket) => {
      last.forwardOut('127.0.0.1', 0, dbHost, dbPort, (err, stream) => {
        if (err || !stream) { socket.destroy(); return }
        socket.pipe(stream as NodeJS.ReadWriteStream).pipe(socket)
      })
    })
    const endpoint = await new Promise<TunnelEndpoint>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') resolve({ host: '127.0.0.1', port: addr.port })
        else reject(new Error('SSH tunnel: failed to bind local forwarder'))
      })
    })

    this.tunnels.set(connId, { clients, server, endpoint })
    return endpoint
  }

  async close(connId: string): Promise<void> {
    const t = this.tunnels.get(connId)
    if (!t) return
    this.tunnels.delete(connId)
    await new Promise<void>((resolve) => t.server.close(() => resolve()))
    t.clients.reverse().forEach((c) => c.end())
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)))
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/main/ssh/tunnel-manager.test.ts`
Expected: PASS (dial order, idempotency, hop-tagged auth error).

- [ ] **Step 5: Commit**

```bash
git add src/main/ssh/tunnel-manager.ts src/main/ssh/tunnel-manager.test.ts
git commit -m "feat: SSH tunnel manager — ordered chain dial + local forwarder"
```

---

### Task 7: Params override + connect/disconnect helpers

**Files:**
- Modify: `src/main/drivers/params.ts`
- Test: `src/main/drivers/params.test.ts` (create if absent)
- Create: `src/main/connection-runtime.ts`
- Test: `src/main/connection-runtime.test.ts`

- [ ] **Step 1: Write the failing test for params override**

Create/append `src/main/drivers/params.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildConnectParams } from './params'
import type { ConnectionConfig } from '../../shared/domain'

const cfg = {
  id: 'c1', type: 'postgres', name: 'p', color: '#000', host: 'db.internal', port: 5432,
  username: 'u', database: 'd', ssl: false, readOnly: false, authSource: '', replicaSet: '',
  ssh: null, createdAt: 1, updatedAt: 1
} as ConnectionConfig

describe('buildConnectParams', () => {
  it('uses the config host/port with no override', () => {
    const p = buildConnectParams(cfg, 'pw')
    expect([p.host, p.port]).toEqual(['db.internal', 5432])
  })
  it('an override rewrites host/port (the local tunnel endpoint), keeping everything else', () => {
    const p = buildConnectParams(cfg, 'pw', { host: '127.0.0.1', port: 54999 })
    expect([p.host, p.port]).toEqual(['127.0.0.1', 54999])
    expect(p.username).toBe('u')
    expect(p.password).toBe('pw')
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/drivers/params.test.ts`
Expected: FAIL (override arg ignored).

- [ ] **Step 3: Implement params override**

Replace `src/main/drivers/params.ts`:

```ts
import type { ConnectionConfig } from '../../shared/domain'
import type { ConnectParams } from './types'

/** Build driver ConnectParams from a stored config + its secret. An optional
 *  override replaces host/port with the local SSH tunnel endpoint. */
export function buildConnectParams(
  config: ConnectionConfig,
  password: string | null,
  override?: { host: string; port: number }
): ConnectParams {
  return {
    id: config.id, type: config.type,
    host: override?.host ?? config.host,
    port: override?.port ?? config.port,
    username: config.username, password, database: config.database, ssl: config.ssl,
    authSource: config.authSource, replicaSet: config.replicaSet
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/main/drivers/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for connect helpers**

Create `src/main/connection-runtime.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { connectVia, disconnectVia, type ConnectDeps } from './connection-runtime'
import { SshTunnelManager } from './ssh/tunnel-manager'
import type { ConnectionConfig, SshConfig } from '../shared/domain'

const base = {
  id: 'c1', type: 'postgres', name: 'p', color: '#000', host: 'db.internal', port: 5432,
  username: 'u', database: 'd', ssl: false, readOnly: false, authSource: '', replicaSet: '',
  createdAt: 1, updatedAt: 1
}
const ssh: SshConfig = { enabled: true, hops: [{ id: 'h1', host: 'bastion', port: 22, username: 'ec2', auth: 'password', keyPath: '' }] }

function fakeDriver() {
  return { connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) } as any
}

describe('connectVia', () => {
  it('connects directly when SSH is absent', async () => {
    const driver = fakeDriver()
    const deps: ConnectDeps = { tunnels: new SshTunnelManager(), readFile: () => Buffer.from(''), getHopSecret: () => null, dbPassword: 'pw' }
    await connectVia(driver, { ...base, ssh: null } as ConnectionConfig, deps)
    expect(driver.connect).toHaveBeenCalledOnce()
    expect(driver.connect.mock.calls[0][0].host).toBe('db.internal')
  })

  it('opens a tunnel and rewrites host/port when SSH is enabled', async () => {
    const driver = fakeDriver()
    const tunnels = { open: vi.fn(async () => ({ host: '127.0.0.1', port: 55001 })), close: vi.fn() } as any
    const deps: ConnectDeps = { tunnels, readFile: () => Buffer.from(''), getHopSecret: () => 'pw', dbPassword: 'dbpw' }
    await connectVia(driver, { ...base, ssh } as ConnectionConfig, deps)
    expect(tunnels.open).toHaveBeenCalledWith('c1', expect.any(Array), 'db.internal', 5432)
    expect(driver.connect.mock.calls[0][0]).toMatchObject({ host: '127.0.0.1', port: 55001, password: 'dbpw' })
  })

  it('skips the tunnel when SSH is configured but disabled', async () => {
    const driver = fakeDriver()
    const tunnels = { open: vi.fn(), close: vi.fn() } as any
    const deps: ConnectDeps = { tunnels, readFile: () => Buffer.from(''), getHopSecret: () => null, dbPassword: 'pw' }
    await connectVia(driver, { ...base, ssh: { enabled: false, hops: ssh.hops } } as ConnectionConfig, deps)
    expect(tunnels.open).not.toHaveBeenCalled()
    expect(driver.connect.mock.calls[0][0].host).toBe('db.internal')
  })
})

describe('disconnectVia', () => {
  it('disconnects the driver then closes the tunnel', async () => {
    const driver = fakeDriver()
    const tunnels = { close: vi.fn(async () => {}) } as any
    await disconnectVia(driver, { ...base, ssh } as ConnectionConfig, tunnels)
    expect(driver.disconnect).toHaveBeenCalledWith('c1')
    expect(tunnels.close).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 6: Run — expect failure**

Run: `npx vitest run src/main/connection-runtime.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement connection-runtime**

Create `src/main/connection-runtime.ts`:

```ts
import type { ConnectionConfig } from '../shared/domain'
import type { DatabaseDriver } from './drivers/types'
import { buildConnectParams } from './drivers/params'
import { resolveHop } from './ssh/auth'
import type { SshTunnelManager } from './ssh/tunnel-manager'

export interface ConnectDeps {
  tunnels: SshTunnelManager
  readFile: (p: string) => Buffer
  /** Passphrase/password for a hop, by hop id (typed override or stored secret). */
  getHopSecret: (hopId: string) => string | null
  dbPassword: string | null
}

/** Connect a driver, transparently routing through an SSH tunnel when the
 *  connection has one enabled. The driver always sees a plain host/port. */
export async function connectVia(driver: DatabaseDriver, config: ConnectionConfig, deps: ConnectDeps): Promise<void> {
  if (config.ssh?.enabled && config.ssh.hops.length > 0) {
    const resolved = config.ssh.hops.map((h) => resolveHop(h, deps.getHopSecret(h.id), deps.readFile))
    const endpoint = await deps.tunnels.open(config.id, resolved, config.host, config.port)
    await driver.connect(buildConnectParams(config, deps.dbPassword, endpoint))
  } else {
    await driver.connect(buildConnectParams(config, deps.dbPassword))
  }
}

export async function disconnectVia(driver: DatabaseDriver, config: ConnectionConfig, tunnels: SshTunnelManager): Promise<void> {
  await driver.disconnect(config.id)
  await tunnels.close(config.id)
}
```

- [ ] **Step 8: Run — expect pass**

Run: `npx vitest run src/main/connection-runtime.test.ts src/main/drivers/params.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/drivers/params.ts src/main/drivers/params.test.ts src/main/connection-runtime.ts src/main/connection-runtime.test.ts
git commit -m "feat: connect/disconnect helpers that route through the SSH tunnel"
```

---

### Task 8: Wire the tunnel into IPC, query-service, preload, hooks

**Files:**
- Modify: `src/shared/ipc.ts` (req shapes + `dialog.openFile`)
- Modify: `src/main/ipc.ts` (tunnels instance, connect/disconnect via helpers, ssh secrets, openFile)
- Modify: `src/main/query-service.ts` (accept tunnels, use connectVia)
- Modify: `src/preload/index.ts` (api: create/update/test carry sshSecrets; dialog.openFile)
- Modify: `src/renderer/src/lib/hooks.ts` (thread sshSecrets through)

There are no unit tests for the IPC wiring itself (the repo tests logic in libs, and the moving pieces here are already covered by Tasks 3–7). Verify with typecheck + the existing suite; the end-to-end path is covered by the integration test (Task 10).

- [ ] **Step 1: IPC channel types**

In `src/shared/ipc.ts`, import `SshConfig` is not needed (ssh rides inside `ConnectionInput`). Change the three req shapes to carry typed SSH secrets, and add the file dialog channel:

```ts
  'connections.create': { req: { input: ConnectionInput; password: string | null; sshSecrets?: Record<string, string> }; res: ConnectionConfig }
  'connections.update': { req: { id: string; patch: Partial<ConnectionInput>; password?: string | null; sshSecrets?: Record<string, string> }; res: ConnectionConfig }
  'connections.test': { req: { input: ConnectionInput; password: string | null; id?: string; sshSecrets?: Record<string, string> }; res: null }
```

Add next to `dialog.pickDirectory`:

```ts
  'dialog.openFile': { req: { title?: string }; res: string | null }
```

- [ ] **Step 2: query-service accepts tunnels**

In `src/main/query-service.ts`, add to `RunArgs`:

```ts
  tunnels: import('./ssh/tunnel-manager').SshTunnelManager
```

Replace the direct connect line:

```ts
  await driver.connect(buildConnectParams(config, secrets.getPassword(config.id)))
```

with:

```ts
  const { connectVia } = await import('./connection-runtime')
  await connectVia(driver, config, {
    tunnels: args.tunnels,
    readFile: (p) => require('fs').readFileSync(p),
    getHopSecret: (hopId) => secrets.getSecret(config.id, `ssh:${hopId}`),
    dbPassword: secrets.getPassword(config.id)
  })
```

(Remove the now-unused `buildConnectParams` import if the linter flags it.)

- [ ] **Step 3: main IPC wiring**

In `src/main/ipc.ts`:

Add near the top (after the driver registrations):

```ts
import { SshTunnelManager } from './ssh/tunnel-manager'
import { disconnectVia, connectVia } from './connection-runtime'
import { readFileSync } from 'fs'
const tunnels = new SshTunnelManager()

/** Persist the SSH secrets the user typed this save, keyed `ssh:<hopId>`. Blank
 *  ones are absent from the map (renderer only sends typed values) → keep existing. */
function writeSshSecrets(secrets: ReturnType<typeof makeSecretStore>, connId: string, sshSecrets?: Record<string, string>): void {
  if (!sshSecrets) return
  for (const [hopId, value] of Object.entries(sshSecrets)) {
    if (value !== '') secrets.setSecret(connId, `ssh:${hopId}`, value)
  }
}
```

Update `connections.create`:

```ts
  handle('connections.create', ({ input, password, sshSecrets }) => {
    const { db, secrets } = store()
    const c = conns.createConnection(db, input, now())
    if (password !== null) secrets.setPassword(c.id, password)
    writeSshSecrets(secrets, c.id, sshSecrets)
    return ok(c)
  })
```

Update `connections.update` (add the ssh-secret write before the disconnect):

```ts
    if (password !== undefined) {
      if (password === null) secrets.deletePassword(id)
      else secrets.setPassword(id, password)
    }
    writeSshSecrets(secrets, id, sshSecrets)
```

(the handler signature becomes `async ({ id, patch, password, sshSecrets }) =>`).

Update `connections.delete` to clear all secrets and close any tunnel:

```ts
  handle('connections.delete', async (id) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, id)
    if (c && drivers.has(c.type)) await disconnectVia(drivers.get(c.type), c, tunnels)
    secrets.deleteAllSecrets(id)
    conns.deleteConnection(db, id)
    return ok(null)
  })
```

Update `connections.disconnect`:

```ts
  handle('connections.disconnect', async (id) => {
    const c = conns.getConnection(store().db, id)
    if (c && drivers.has(c.type)) await disconnectVia(drivers.get(c.type), c, tunnels)
    return ok(null)
  })
```

Update `connections.update`'s two existing `drivers.get(...).disconnect(id)` calls to also close the tunnel — replace each with a tunnel-aware close. The `before`-type change one:

```ts
    if (before && before.type !== c.type && drivers.has(before.type)) {
      await disconnectVia(drivers.get(before.type), before, tunnels)
    }
```

and the trailing pool-drop:

```ts
    if (drivers.has(c.type)) await disconnectVia(drivers.get(c.type), c, tunnels)
```

Update `connections.test` to bring up the tunnel via a throwaway config and tear it down after:

```ts
  handle('connections.test', async ({ input, password, id, sshSecrets }) => {
    const { secrets } = store()
    const pwd = resolveTestPassword(password, id, secrets)
    const driver = drivers.get(input.type)
    const testId = `test:${id ?? 'new'}`
    const config = { ...input, id: testId, createdAt: 0, updatedAt: 0 } as conns.ConnectionConfig
    try {
      await connectVia(driver, config, {
        tunnels,
        readFile: (p) => readFileSync(p),
        getHopSecret: (hopId) => sshSecrets?.[hopId] || (id ? secrets.getSecret(id, `ssh:${hopId}`) : null),
        dbPassword: pwd
      })
      // connectVia pools under testId; immediately verify + tear down.
      await driver.disconnect(testId)
    } finally {
      await tunnels.close(testId)
    }
    return ok(null)
  })
```

Note: `connectVia` already calls `driver.connect`, which for every driver opens + verifies the pool (Plan-3 contract). If you prefer `testConnection`'s throwaway semantics, keep using `connectVia` here for the tunnel and call `driver.testConnection` with `buildConnectParams(config, pwd, endpoint)` instead — either is acceptable; the above reuses the pooled path then disconnects. (Pick one and keep it; the pooled-then-disconnect path above is simplest.)

In `query.run` and each `schema.*` handler, pass `tunnels` into `runUserQuery` and replace any direct `driver.connect(...)` in schema handlers with `connectVia(...)`. For `runUserQuery` calls add `tunnels` to the args object:

```ts
    const result = await runUserQuery({ db, secrets, driver: drivers.get(c.type), connectionId, query, queryId, now: () => Date.now(), tunnels })
```

For the `schema.objects` / `schema.columns` handlers (which call the driver after a connect), route their connect through `connectVia` with the same deps shape as query-service (db password + `ssh:<hopId>` secrets). If those handlers currently rely on `runUserQuery`-style connect, mirror the deps object.

Finally add the file dialog handler (near `dialog.pickDirectory`):

```ts
  handle('dialog.openFile', async ({ title }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const r = await dialog.showOpenDialog(win, { title, properties: ['openFile'] })
    return ok(r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0])
  })
```

And close all tunnels on quit — find where the app cleans up pools (or add to the `window-all-closed`/`before-quit` path in `src/main/index.ts`):

```ts
  await tunnels.closeAll()
```

Export `tunnels` or a `closeAllTunnels()` from `ipc.ts` if the quit handler lives elsewhere:

```ts
export function closeAllTunnels(): Promise<void> { return tunnels.closeAll() }
```

- [ ] **Step 4: preload API**

In `src/preload/index.ts`, update the connection methods and add the dialog method:

```ts
    create: (input, password, sshSecrets) => invoke('connections.create', { input, password, sshSecrets }),
    update: (id, patch, password, sshSecrets) => invoke('connections.update', { id, patch, password, sshSecrets }),
    test: (input, password, id, sshSecrets) => invoke('connections.test', { input, password, id, sshSecrets }),
```

```ts
  dialog: {
    pickDirectory: () => invoke('dialog.pickDirectory', undefined),
    openFile: (title) => invoke('dialog.openFile', { title })
  }
```

Update the matching `window.api` TypeScript declaration (the `Api` interface in preload, wherever `connections.create` etc. are typed) so `sshSecrets?: Record<string, string>` and `dialog.openFile(title?: string)` are part of the surface.

- [ ] **Step 5: hooks thread sshSecrets**

In `src/renderer/src/lib/hooks.ts`, extend `useSaveConnection` and `useTestConnection` to accept and forward `sshSecrets`:

```ts
// useSaveConnection mutationFn args:
    }: { id?: string; input: ConnectionInput; password: string | undefined | null; sshSecrets?: Record<string, string> }) => {
      if (id) return window.api.connections.update(id, input, password === '' ? undefined : password, sshSecrets).then(unwrap)
      return window.api.connections.create(input, password ?? null, sshSecrets).then(unwrap)
```

```ts
// useTestConnection mutationFn args:
    }: { input: ConnectionInput; password: string | null; id?: string; sshSecrets?: Record<string, string> }) =>
      window.api.connections.test(input, password, id, sshSecrets).then(unwrap),
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: clean; all tests pass (count up from the new lib/persistence tests).

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/main/ipc.ts src/main/query-service.ts src/preload/index.ts src/renderer/src/lib/hooks.ts
git commit -m "feat: route connect/test/schema through the SSH tunnel; add dialog.openFile + ssh secrets IPC"
```

---

### Task 9: Connection modal — SSH section + hop editor

**Files:**
- Create: `src/renderer/src/components/SshHopEditor.tsx`
- Modify: `src/renderer/src/components/ConnectionModal.tsx`
- Modify: `src/renderer/src/styles.css` (hop list styles)

No component tests (repo convention). The validation/normalization logic is already unit-tested in `ssh-config.ts`.

- [ ] **Step 1: Build the hop editor component**

Create `src/renderer/src/components/SshHopEditor.tsx`:

```tsx
import type { SshConfig, SshHop } from '@shared/domain'
import { emptyHop } from '../lib/ssh-config'

interface Props {
  ssh: SshConfig
  /** Typed passphrases/passwords by hop id (write-only; blank = keep existing on edit). */
  secrets: Record<string, string>
  isEdit: boolean
  onChange: (ssh: SshConfig) => void
  onSecretChange: (hopId: string, value: string) => void
}

function newHopId(): string {
  return crypto.randomUUID()
}

export default function SshHopEditor({ ssh, secrets, isEdit, onChange, onSecretChange }: Props): JSX.Element {
  function patchHop(i: number, patch: Partial<SshHop>): void {
    onChange({ ...ssh, hops: ssh.hops.map((h, j) => (j === i ? { ...h, ...patch } : h)) })
  }
  function addHop(): void {
    onChange({ ...ssh, hops: [...ssh.hops, emptyHop(newHopId())] })
  }
  function removeHop(i: number): void {
    onChange({ ...ssh, hops: ssh.hops.filter((_, j) => j !== i) })
  }
  function move(i: number, dir: -1 | 1): void {
    const j = i + dir
    if (j < 0 || j >= ssh.hops.length) return
    const hops = ssh.hops.slice()
    ;[hops[i], hops[j]] = [hops[j], hops[i]]
    onChange({ ...ssh, hops })
  }
  async function pickKey(i: number): Promise<void> {
    const path = await window.api.dialog.openFile('Select private key')
    if (path) patchHop(i, { keyPath: path })
  }

  return (
    <div className="ssh-hops">
      {ssh.hops.map((h, i) => (
        <div className="ssh-hop" key={h.id}>
          <div className="ssh-hop-head">
            <span className="ssh-hop-order">{i === ssh.hops.length - 1 ? 'Target' : `Jump #${i + 1}`}</span>
            <span className="spacer" />
            <button type="button" className="btn ghost xs" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
            <button type="button" className="btn ghost xs" onClick={() => move(i, 1)} disabled={i === ssh.hops.length - 1} aria-label="Move down">↓</button>
            <button type="button" className="btn ghost xs" onClick={() => removeHop(i)} aria-label="Remove hop">✕</button>
          </div>
          <div className="form-row-2">
            <div className="form-row">
              <label>Host</label>
              <input type="text" value={h.host} onChange={(e) => patchHop(i, { host: e.target.value })} placeholder="35.180.247.138" />
            </div>
            <div className="form-row" style={{ maxWidth: 96 }}>
              <label>Port</label>
              <input type="number" value={h.port} min={1} max={65535} onChange={(e) => patchHop(i, { port: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form-row">
            <label>Username</label>
            <input type="text" value={h.username} onChange={(e) => patchHop(i, { username: e.target.value })} placeholder="ec2-user" />
          </div>
          <div className="form-row">
            <label>Auth</label>
            <select value={h.auth} onChange={(e) => patchHop(i, { auth: e.target.value as SshHop['auth'] })}>
              <option value="key">Private key</option>
              <option value="password">Password</option>
            </select>
          </div>
          {h.auth === 'key' ? (
            <>
              <div className="form-row">
                <label>Private key</label>
                <div className="ssh-key-pick">
                  <input type="text" value={h.keyPath} onChange={(e) => patchHop(i, { keyPath: e.target.value })} placeholder="/Users/me/aws.pem" />
                  <button type="button" className="btn ghost" onClick={() => pickKey(i)}>Browse…</button>
                </div>
              </div>
              <div className="form-row">
                <label>Passphrase</label>
                <input type="password" value={secrets[h.id] ?? ''} onChange={(e) => onSecretChange(h.id, e.target.value)} placeholder={isEdit ? 'leave blank to keep current' : 'optional'} />
              </div>
            </>
          ) : (
            <div className="form-row">
              <label>Password</label>
              <input type="password" value={secrets[h.id] ?? ''} onChange={(e) => onSecretChange(h.id, e.target.value)} placeholder={isEdit ? 'leave blank to keep current' : ''} />
            </div>
          )}
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={addHop}>+ Add hop</button>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the modal**

In `src/renderer/src/components/ConnectionModal.tsx`:

Add imports:

```tsx
import SshHopEditor from './SshHopEditor'
import { emptyHop, validateSshConfig } from '../lib/ssh-config'
import type { SshConfig } from '@shared/domain'
```

Add state (next to `password`):

```tsx
  const [sshSecrets, setSshSecrets] = useState<Record<string, string>>({})
```

In the edit-`useEffect`, include `ssh: existingConn.ssh` in the `setForm({...})` object, and reset `setSshSecrets({})` in both branches.

Add a toggle handler:

```tsx
  function setSshEnabled(enabled: boolean) {
    const cur: SshConfig = form.ssh ?? { enabled: false, hops: [] }
    const hops = enabled && cur.hops.length === 0 ? [emptyHop(crypto.randomUUID())] : cur.hops
    setField('ssh', { enabled, hops })
  }
```

Render an SSH section (place it after the Read-only checkbox, before the test status):

```tsx
            {/* SSH tunnel */}
            <div className="form-row">
              <label className="checkbox-row">
                <input type="checkbox" checked={!!form.ssh?.enabled} onChange={(e) => setSshEnabled(e.target.checked)} />
                Use SSH tunnel
              </label>
            </div>
            {form.ssh?.enabled && (
              <SshHopEditor
                ssh={form.ssh}
                secrets={sshSecrets}
                isEdit={isEdit}
                onChange={(ssh) => setField('ssh', ssh)}
                onSecretChange={(hopId, value) => setSshSecrets((prev) => ({ ...prev, [hopId]: value }))}
              />
            )}
```

Gate save/test on SSH validity. In `handleSave` (top, after `setSaveError(null)`):

```tsx
    const sshErr = validateSshConfig(form.ssh)
    if (sshErr) { setSaveError(sshErr); return }
```

Pass `sshSecrets` through both mutations: `save.mutate({ id: editId, input: form, password: pwd, sshSecrets }, …)` and `test.mutate({ input: form, password: pwd, id: editId, sshSecrets }, …)`. Also add the same `sshErr` guard at the top of `handleTest`.

- [ ] **Step 3: Styles**

Append to `src/renderer/src/styles.css`:

```css
/* ── SSH hop editor ── */
.ssh-hops { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.ssh-hop { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: var(--bg-2); }
.ssh-hop-head { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.ssh-hop-order { font-size: 12px; color: var(--text-2); font-weight: 600; }
.ssh-key-pick { display: flex; gap: 6px; }
.ssh-key-pick input { flex: 1; }
.btn.xs { padding: 2px 6px; font-size: 12px; line-height: 1; }
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SshHopEditor.tsx src/renderer/src/components/ConnectionModal.tsx src/renderer/src/styles.css
git commit -m "feat: SSH tunnel section + jump-server hop editor in the connection modal"
```

---

### Task 10: Integration test — real sshd → demo Postgres (single hop)

**Files:**
- Create: `src/main/ssh/tunnel.integration.test.ts`
- Possibly modify: `package.json` (add `testcontainers` core if not already present)

Proves the real `forwardOut` + local-server plumbing: a connection forwarded through a genuine sshd reaches a real Postgres and runs a query.

- [ ] **Step 1: Confirm testcontainers core is available**

Run: `node -e "require('testcontainers'); console.log('ok')"`
Expected: `ok`. If it errors, run `npm i -D testcontainers` and retry.

- [ ] **Step 2: Write the integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Network, type StartedTestContainer, type StartedNetwork } from 'testcontainers'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { SshTunnelManager } from './tunnel-manager'
import type { ResolvedHop } from './auth'

describe('SSH tunnel (integration, requires Docker)', () => {
  let network: StartedNetwork
  let pg: StartedPostgreSqlContainer
  let sshd: StartedTestContainer
  let mgr: SshTunnelManager

  beforeAll(async () => {
    network = await new Network().start()
    pg = await new PostgreSqlContainer('postgres:16-alpine')
      .withNetwork(network).withNetworkAliases('pgdb')
      .withDatabase('test').withUsername('test').withPassword('test')
      .start()
    sshd = await new GenericContainer('lscr.io/linuxserver/openssh-server:latest')
      .withNetwork(network)
      .withEnvironment({ PASSWORD_ACCESS: 'true', USER_NAME: 'tester', USER_PASSWORD: 'tpw', DOCKER_MODS: '' })
      .withExposedPorts(2222)
      .start()
    mgr = new SshTunnelManager()
  }, 120_000)

  afterAll(async () => {
    await mgr?.closeAll()
    await sshd?.stop(); await pg?.stop(); await network?.stop()
  })

  it('forwards a pg connection through the sshd to the database', async () => {
    const hop: ResolvedHop = {
      host: sshd.getHost(), port: sshd.getMappedPort(2222),
      username: 'tester', auth: 'password', password: 'tpw'
    }
    // From inside the docker network the DB is reachable as pgdb:5432.
    const ep = await mgr.open('it1', [hop], 'pgdb', 5432)
    const client = new Client({ host: ep.host, port: ep.port, user: 'test', password: 'test', database: 'test' })
    await client.connect()
    const r = await client.query('SELECT 1 AS n')
    expect(r.rows[0].n).toBe(1)
    await client.end()
  }, 60_000)
})
```

- [ ] **Step 3: Run the integration suite**

Run: `npx vitest run --config vitest.integration.config.ts src/main/ssh/tunnel.integration.test.ts`
Expected: PASS (the SELECT returns through the tunnel). If the openssh image's first-boot key setup races the connection, the test's own `client.connect()` retry window covers it; if not, add a 1s wait after `sshd.start()`.

- [ ] **Step 4: Commit**

```bash
git add src/main/ssh/tunnel.integration.test.ts package.json package-lock.json
git commit -m "test: SSH tunnel integration — pg through a real sshd hop"
```

---

### Task 11: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README feature note**

Add an SSH bullet to the features list (near Connections):

```markdown
- **SSH tunnels** — reach a database through one or more SSH hops (jump-server chain), configured per connection. Key-file (with passphrase) or password auth per hop; passphrases/passwords are encrypted with the OS keychain and write-only like DB passwords. The tunnel is opened in the main process and the drivers connect through it unchanged.
```

Update the test counts line to the new totals (run the suite to get exact numbers first).

- [ ] **Step 2: Full gate run**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run test:integration`
Expected: typecheck/lint clean; unit suite green; integration suite green (Docker required).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README SSH tunnel feature + test counts"
```

---

## Self-review

**Spec coverage:**
- Jump-server chain (any depth) → Tasks 1 (types), 6 (ordered dial), 9 (hop editor). ✓
- Key+passphrase / password auth, no agent → Tasks 5 (resolveHop), 9 (auth select). ✓
- Key referenced by path → Task 5 reads keyPath at connect time; only passphrase is a secret. ✓
- Accept-any host key (v1) → no hostVerifier supplied to ssh2 in Task 6 (default accept); README/spec document the limitation. ✓
- Tunnel-in-main, drivers blind → Tasks 6–8 (connectVia rewrites host/port; drivers untouched). ✓
- JSON column persistence + migration → Task 3. ✓
- Composite-key secrets + migration + write-only → Tasks 4, 8. ✓
- `dialog.openFile` (+1 channel) → Task 8. ✓
- Error surfacing (hop-tagged) → Tasks 5, 6. ✓
- Tests: unit libs + single-hop integration → Tasks 2,4,5,6,7 (unit), 10 (integration). ✓

**Placeholder scan:** Task 8 notes two acceptable implementations for `connections.test`; it instructs picking one (the pooled-then-disconnect path is fully specified). No TBD/“handle errors”/empty code blocks elsewhere.

**Type consistency:** `SshHop`/`SshConfig` fields, `ResolvedHop` shape, `ConnectDeps`, secret-key convention `ssh:${hopId}`, `buildConnectParams(…, override?)`, and `SshClientLike` are used identically across Tasks 1–10.

**Known seam to watch during execution:** the exact `schema.objects`/`schema.columns` connect path in `ipc.ts` — Task 8 says to route it through `connectVia` with the same deps as query-service; the implementer should confirm those handlers’ current connect call and mirror it (they were not all shown in this plan).
