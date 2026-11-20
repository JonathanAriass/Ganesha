import { createDecipheriv, pbkdf2Sync } from 'crypto'
import type { ConnectionType, SshHop } from '../../shared/domain'
import { cleanEnvironment } from '../../shared/environment'
import type { ImportSkip } from '../../shared/transfer'
import {
  parseTransferFile, planFromTransferFile,
  type ExportedConnection, type ExportedGroup, type ImportPlan, type SecretsPayload
} from './connection-transfer'

/** Importers for files written by other tools. Each one turns a foreign file into the same
 *  ImportPlan a Ganesha export produces, so applying it (groups by name, duplicates skipped,
 *  all-or-nothing) is shared. Every field is rebuilt from scratch: nothing in the file reaches
 *  the database unchecked. */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const DEFAULT_COLOR = '#6366f1'
const DEFAULT_PORT: Record<ConnectionType, number> = { postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 }

/** A port from a number, a numeric string or an EJSON number wrapper; `fallback` otherwise. */
function port(v: unknown, fallback: number): number {
  const raw = isObj(v) ? v.$numberInt ?? v.$numberLong ?? v.$numberDouble : v
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback
}

function decode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

// ── MongoDB Compass ──────────────────────────────────────────────────────────────────────

const COMPASS_TYPE = 'Compass Connections'
/** Compass's ten favourite colours, by the names it shows for them. */
const COMPASS_COLORS: Record<string, string> = {
  color1: '#22c55e', color2: '#14b8a6', color3: '#3b82f6', color4: '#6366f1', color5: '#a855f7',
  color6: '#ef4444', color7: '#ec4899', color8: '#f97316', color9: '#eab308', color10: '#94a3b8'
}

export interface MongoUri {
  srv: boolean
  hosts: Array<{ host: string; port: number }>
  username: string
  password: string
  database: string
  params: URLSearchParams
}

/** Parse a MongoDB connection string. `new URL` cannot (several hosts, no port on srv), so
 *  this splits it by hand; null when it is not a MongoDB address at all. */
export function parseMongoUri(uri: string): MongoUri | null {
  const m = /^mongodb(\+srv)?:\/\/(.*)$/s.exec(uri.trim())
  if (!m) return null
  const rest = m[2]
  const cut = rest.search(/[/?]/)
  const authority = cut === -1 ? rest : rest.slice(0, cut)
  const tail = cut === -1 ? '' : rest.slice(cut)
  const at = authority.lastIndexOf('@')
  const userinfo = at === -1 ? '' : authority.slice(0, at)
  const colon = userinfo.indexOf(':')
  const hosts = authority.slice(at + 1).split(',').filter((h) => h !== '').map((h) => {
    // [::1]:27017 — the last colon outside the brackets separates the port.
    const hm = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(h)
    return hm ? { host: decode(hm[1]), port: port(hm[2], 27017) } : { host: decode(h), port: 27017 }
  })
  if (hosts.length === 0) return null
  const q = tail.indexOf('?')
  const path = (q === -1 ? tail : tail.slice(0, q)).replace(/^\//, '')
  return {
    srv: m[1] !== undefined,
    hosts,
    username: decode(colon === -1 ? userinfo : userinfo.slice(0, colon)),
    password: colon === -1 ? '' : decode(userinfo.slice(colon + 1)),
    database: decode(path),
    params: new URLSearchParams(q === -1 ? '' : tail.slice(q + 1))
  }
}

/** Decrypt one `connectionSecrets` value of a passphrase-protected Compass export:
 *  base64 of version(2, = 1) · salt(16) · iv(16) · tag(16) · ciphertext, AES-256-GCM with a
 *  PBKDF2-SHA512 key (100 000 rounds). The plaintext is `{ secrets: {...} }`. */
export function decryptCompassSecrets(blob: string, passphrase: string, keys = new Map<string, Buffer>()): Record<string, unknown> {
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < 50 || buf.readUInt16BE(0) !== 1) throw new Error('This Compass file uses an unsupported encryption scheme')
  const salt = buf.subarray(2, 18)
  const saltKey = salt.toString('base64')
  let key = keys.get(saltKey)
  if (!key) {
    key = pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, 100000, 32, 'sha512')
    keys.set(saltKey, key) // one export uses one salt: derive the key once, not per connection
  }
  let plain: string
  try {
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(18, 34))
    d.setAuthTag(buf.subarray(34, 50))
    plain = Buffer.concat([d.update(buf.subarray(50)), d.final()]).toString('utf8')
  } catch {
    throw new Error('Wrong passphrase')
  }
  const parsed: unknown = JSON.parse(plain)
  return isObj(parsed) && isObj(parsed.secrets) ? parsed.secrets : {}
}

const SSH_HOP = 'ssh'

/** Compass lifts the password out of the connection string as it is written there, that is
 *  percent-encoded ("p%40ss" for "p@ss"), so the secret it keeps has to be decoded. */
const compassPassword = (v: unknown): string => decode(str(v))

export function parseCompass(raw: Record<string, unknown>): ImportPlan {
  if (port(raw.version, 0) !== 1) throw new Error('This file was made by a newer version of Compass')
  if (!Array.isArray(raw.connections)) throw new Error('Compass file is malformed')

  const connections: ExportedConnection[] = []
  const skipped: ImportSkip[] = []
  const plain: SecretsPayload = {}
  const encrypted = new Map<string, string>() // file connection id → connectionSecrets blob
  const multiHost: string[] = []

  raw.connections.forEach((c, i) => {
    if (!isObj(c) || !isObj(c.connectionOptions)) { skipped.push({ name: `Connection ${i + 1}`, reason: 'Unreadable entry' }); return }
    const fav = isObj(c.favorite) ? c.favorite : {}
    const uri = parseMongoUri(str(c.connectionOptions.connectionString))
    const first = uri?.hosts[0]
    const name = str(fav.name).trim() || (first ? `${first.host}:${first.port}` : `Connection ${i + 1}`)
    if (!uri || !first) { skipped.push({ name, reason: 'No MongoDB address' }); return }
    // An srv address is a DNS lookup, not a host and port: there is nothing to store it as.
    if (uri.srv) { skipped.push({ name, reason: 'mongodb+srv addresses are not supported' }); return }

    if (uri.hosts.length > 1) multiHost.push(name)
    const id = str(c.id) || `compass-${i}`
    const tunnel = isObj(c.connectionOptions.sshTunnel) ? c.connectionOptions.sshTunnel : null
    const keyFile = tunnel ? (Array.isArray(tunnel.identityKeyFile) ? str(tunnel.identityKeyFile[0]) : str(tunnel.identityKeyFile)) : ''
    const hop: SshHop | null = tunnel && str(tunnel.host) !== ''
      ? { id: SSH_HOP, host: str(tunnel.host), port: port(tunnel.port, 22), username: str(tunnel.username), auth: keyFile ? 'key' : 'password', keyPath: keyFile }
      : null
    const on = (k: string): boolean => uri.params.get(k) === 'true'
    connections.push({
      id, type: 'mongodb', name, color: COMPASS_COLORS[str(fav.color)] ?? (/^#[0-9a-f]{6}$/i.test(str(fav.color)) ? str(fav.color) : DEFAULT_COLOR),
      host: first.host, port: first.port, username: uri.username, database: uri.database,
      ssl: on('tls') || on('ssl'), readOnly: false, requireCommit: false,
      authSource: uri.params.get('authSource') ?? '', replicaSet: uri.params.get('replicaSet') ?? '',
      ssh: hop ? { enabled: true, hops: [hop] } : null, repoPath: null, groupId: null, environment: ''
    })

    if (typeof c.connectionSecrets === 'string' && c.connectionSecrets !== '') encrypted.set(id, c.connectionSecrets)
    const entry: SecretsPayload[string] = {}
    if (uri.password !== '') entry.db = uri.password
    const sshSecret = tunnel ? str(keyFile ? tunnel.identityKeyPassphrase : tunnel.password) : ''
    if (hop && sshSecret !== '') entry.ssh = { [SSH_HOP]: sshSecret }
    if (entry.db !== undefined || entry.ssh) plain[id] = entry
  })

  const notes = multiHost.length === 0 ? [] : [
    `${multiHost.join(', ')}: Compass lists several servers for ${multiHost.length === 1 ? 'this connection' : 'these connections'}; only the first one is kept. If it is not the primary, writes will fail — edit the host to point at the primary.`
  ]
  const base = { source: 'compass' as const, groups: [], connections, skipped, notes }
  if (encrypted.size > 0) {
    const byId = new Map(connections.map((c) => [c.id, c]))
    return {
      ...base,
      secrets: {
        kind: 'encrypted',
        decrypt: (passphrase) => {
          const keys = new Map<string, Buffer>()
          const out: SecretsPayload = { ...plain }
          for (const [id, blob] of encrypted) {
            const s = decryptCompassSecrets(blob, passphrase, keys)
            const entry: SecretsPayload[string] = { ...out[id] }
            if (str(s.password) !== '') entry.db = compassPassword(s.password)
            const hop = byId.get(id)?.ssh?.hops[0]
            const sshSecret = hop ? str(hop.auth === 'key' ? s.sshTunnelPassphrase : s.sshTunnelPassword) : ''
            if (sshSecret !== '') entry.ssh = { [SSH_HOP]: sshSecret }
            if (entry.db !== undefined || entry.ssh) out[id] = entry
          }
          return out
        }
      }
    }
  }
  return { ...base, secrets: Object.keys(plain).length > 0 ? { kind: 'plain', payload: plain } : { kind: 'none' } }
}

/** The keychain item Compass (an Electron app) keeps its safe-storage password in on macOS. */
const COMPASS_KEYCHAIN = { service: 'MongoDB Compass Safe Storage', account: 'MongoDB Compass Key' }

/**
 * Decrypt one `connectionSecrets` value of Compass's own store on macOS. It is Chromium's
 * "v10" scheme: AES-128-CBC, IV of 16 spaces, key = PBKDF2-SHA1(keychain password,
 * "saltysalt", 1003 rounds). The plaintext is the secrets object itself.
 */
export function decryptCompassStoreSecrets(blob: string, key: Buffer): Record<string, unknown> {
  const buf = Buffer.from(blob, 'base64')
  if (buf.subarray(0, 3).toString('latin1') !== 'v10') throw new Error('Compass saved these passwords in a way Ganesha cannot read')
  try {
    const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
    const parsed: unknown = JSON.parse(Buffer.concat([d.update(buf.subarray(3)), d.final()]).toString('utf8'))
    return isObj(parsed) ? parsed : {}
  } catch {
    throw new Error('The Compass passwords could not be decrypted with the key in the keychain')
  }
}

export const compassStoreKey = (keychainPassword: string): Buffer => pbkdf2Sync(keychainPassword, 'saltysalt', 1003, 16, 'sha1')

/**
 * Compass's own saved connections, read from its data folder: one object per file, shaped
 * `{ connectionInfo: { id, favorite, connectionOptions }, connectionSecrets }`. The secrets
 * are encrypted with a key Compass keeps in the system keychain. With `keychain` (macOS) the
 * plan can decrypt them once it is handed that key; otherwise they are left behind.
 */
export function parseCompassStore(entries: unknown[], opts: { keychain: boolean } = { keychain: false }): ImportPlan {
  const blobs = new Map<string, string>() // connection id → connectionSecrets
  const connections = entries.map((e) => {
    const info = isObj(e) && isObj(e.connectionInfo) ? e.connectionInfo : null
    if (info && isObj(e) && typeof e.connectionSecrets === 'string' && e.connectionSecrets !== '') blobs.set(str(info.id), e.connectionSecrets)
    return info ? { id: info.id, favorite: info.favorite, connectionOptions: info.connectionOptions } : null
  })
  const plan = parseCompass({ version: 1, connections })
  const wanted = plan.connections.filter((c) => blobs.has(c.id))
  if (wanted.length === 0) return plan
  if (!opts.keychain) {
    plan.notes.push('Passwords saved in Compass stay in the system keychain and are not imported. To bring them, export the connections from Compass with a passphrase and import that file.')
    return plan
  }
  return {
    ...plan,
    secrets: {
      kind: 'keychain', ...COMPASS_KEYCHAIN,
      decrypt: (keychainPassword) => {
        const key = compassStoreKey(keychainPassword)
        const out: SecretsPayload = {}
        for (const c of wanted) {
          const s = decryptCompassStoreSecrets(blobs.get(c.id) as string, key)
          const entry: SecretsPayload[string] = {}
          if (str(s.password) !== '') entry.db = compassPassword(s.password)
          const hop = c.ssh?.hops[0]
          const sshSecret = hop ? str(hop.auth === 'key' ? s.sshTunnelPassphrase : s.sshTunnelPassword) : ''
          if (hop && sshSecret !== '') entry.ssh = { [hop.id]: sshSecret }
          if (entry.db !== undefined || entry.ssh) out[c.id] = entry
        }
        return out
      }
    }
  }
}

// ── DBeaver ──────────────────────────────────────────────────────────────────────────────

/** The key every DBeaver install uses for credentials-config.json unless the project has a
 *  master password (AES-128-CBC; the file starts with the 16-byte IV). */
const DBEAVER_KEY = Buffer.from('babb4a9f774ab853c96c2d653dfe544a', 'hex')

type DbeaverCredentials = Record<string, Record<string, Record<string, unknown>>>

/** Decrypt DBeaver's credentials file; null when it does not open with the default key
 *  (a project protected by a master password). */
export function decryptDbeaverCredentials(buf: Buffer): DbeaverCredentials | null {
  if (buf.length <= 16) return null
  try {
    const d = createDecipheriv('aes-128-cbc', DBEAVER_KEY, buf.subarray(0, 16))
    const parsed: unknown = JSON.parse(Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString('utf8'))
    return isObj(parsed) ? (parsed as DbeaverCredentials) : null
  } catch {
    return null
  }
}

function dbeaverType(provider: string, driver: string): ConnectionType | null {
  const p = provider.toLowerCase()
  if (p === 'mysql') return /maria/i.test(driver) ? 'mariadb' : 'mysql'
  if (p === 'mariadb') return 'mariadb'
  if (p === 'postgresql') return 'postgres'
  if (p === 'mongo' || p === 'mongodb') return 'mongodb'
  return null
}

/** host / port / database out of a JDBC or MongoDB URL, for connections saved as a URL only. */
function fromUrl(url: string): { host: string; port: string; database: string } | null {
  const mongo = parseMongoUri(url)
  if (mongo && !mongo.srv) return { host: mongo.hosts[0].host, port: String(mongo.hosts[0].port), database: mongo.database }
  const m = /^jdbc:[a-z]+:\/\/([^:/?]+)(?::(\d+))?(?:\/([^?;]*))?/i.exec(url)
  return m ? { host: m[1], port: m[2] ?? '', database: decode(m[3] ?? '') } : null
}

/**
 * `credentials` is the sibling credentials-config.json: a Buffer when it exists, null when it
 * does not. Usernames live there too, so it is read even when passwords are left behind.
 */
export function parseDbeaver(raw: Record<string, unknown>, credentials: Buffer | null): ImportPlan {
  if (!isObj(raw.connections)) throw new Error('DBeaver file is malformed')
  const creds = credentials ? decryptDbeaverCredentials(credentials) : null
  const notes: string[] = []
  if (credentials && !creds) {
    notes.push('The DBeaver project is protected by a master password, so user names and passwords could not be read. Connections are imported without them.')
  } else if (!credentials) {
    notes.push('No credentials-config.json next to this file, so connections are imported without user names and passwords.')
  }

  const groups: ExportedGroup[] = []
  const groupIds = new Map<string, string>()
  // DBeaver folders nest freely ("a/b/c"); groups here are two levels deep, so the rest of the
  // path stays in the subgroup's name.
  const groupFor = (folder: string): string | null => {
    const parts = folder.split('/').map((s) => s.trim()).filter((s) => s !== '')
    if (parts.length === 0) return null
    const levels = parts.length > 2 ? [parts[0], parts.slice(1).join(' / ')] : parts
    let parentId: string | null = null
    levels.forEach((name, i) => {
      const key = levels.slice(0, i + 1).join('\u0000')
      let id = groupIds.get(key)
      if (!id) {
        id = `folder-${groups.length}`
        groupIds.set(key, id)
        groups.push({ id, name, parentId })
      }
      parentId = id
    })
    return parentId
  }

  const connections: ExportedConnection[] = []
  const skipped: ImportSkip[] = []
  const payload: SecretsPayload = {}

  for (const [id, c] of Object.entries(raw.connections)) {
    if (!isObj(c)) continue
    const cfg = isObj(c.configuration) ? c.configuration : {}
    const name = str(c.name).trim() || id
    const type = dbeaverType(str(c.provider), str(c.driver))
    if (!type) { skipped.push({ name, reason: `${str(c.provider) || 'This engine'} is not supported` }); continue }
    const url = str(cfg.host) === '' ? fromUrl(str(cfg.url)) : null
    const host = str(cfg.host) || url?.host || ''
    if (host === '') { skipped.push({ name, reason: 'No host' }); continue }

    const own = creds?.[id] ?? {}
    const login = isObj(own['#connection']) ? own['#connection'] : {}
    const handlers = isObj(cfg.handlers) ? cfg.handlers : {}
    const entry: SecretsPayload[string] = {}
    if (str(login.password) !== '') entry.db = str(login.password)

    // SSH: the jump servers come first, in order, then the tunnel's own host.
    const tunnel = isObj(handlers.ssh_tunnel) ? handlers.ssh_tunnel : null
    const hops: SshHop[] = []
    if (tunnel && isObj(tunnel.properties) && str(tunnel.properties.host) !== '') {
      const p = tunnel.properties
      const sshCreds = isObj(own['network/ssh_tunnel']) ? own['network/ssh_tunnel'] : {}
      const add = (hopId: string, prefix: string, user: string): void => {
        const auth = str(p[`${prefix}authType`]).toUpperCase() === 'PASSWORD' ? 'password' : 'key'
        hops.push({
          id: hopId, host: str(p[`${prefix}host`]), port: port(p[`${prefix}port`], 22), username: user,
          auth, keyPath: auth === 'key' ? str(p[`${prefix}keyPath`]) : ''
        })
        const secret = str(sshCreds[`${prefix}password`])
        if (secret !== '') (entry.ssh ??= {})[hopId] = secret
      }
      for (let i = 0; str(p[`jumpServer${i}.host`]) !== ''; i++) {
        if (p[`jumpServer${i}.enabled`] === false) continue
        add(`jump${i}`, `jumpServer${i}.`, str(p[`jumpServer${i}.name`]) || str(sshCreds[`jumpServer${i}.user`]))
      }
      add('ssh', '', str(sshCreds.user) || str(p.user))
    }

    const sslHandler = Object.entries(handlers).some(([k, h]) => /ssl/i.test(k) && isObj(h) && h.enabled === true)
    const props = isObj(cfg.properties) ? cfg.properties : {}
    connections.push({
      id, type, name, color: DEFAULT_COLOR, host,
      port: port(str(cfg.port) || url?.port, DEFAULT_PORT[type]),
      username: str(login.user) || str(cfg.user), database: str(cfg.database) || url?.database || '',
      ssl: sslHandler || str(props.useSSL) === 'true' || ['require', 'verify-ca', 'verify-full'].includes(str(props.sslmode)),
      readOnly: c['read-only'] === true, requireCommit: false, authSource: '', replicaSet: '',
      ssh: hops.length > 0 ? { enabled: tunnel?.enabled === true, hops } : null,
      repoPath: null, groupId: groupFor(str(c.folder)),
      // DBeaver's connection type is the same idea as the environment label. "dev" is what
      // every new connection gets there, so it says nothing and is left out.
      environment: str(cfg.type) === 'dev' ? '' : cleanEnvironment(str(cfg.type).toUpperCase())
    })
    if (entry.db !== undefined || entry.ssh) payload[id] = entry
  }

  // Only the folders that ended up holding an imported connection (and their parents).
  const used = new Set<string>()
  for (const c of connections) {
    const g = groups.find((x) => x.id === c.groupId)
    if (g) { used.add(g.id); if (g.parentId) used.add(g.parentId) }
  }
  return {
    source: 'dbeaver', groups: groups.filter((g) => used.has(g.id)), connections, skipped, notes,
    secrets: Object.keys(payload).length > 0 ? { kind: 'plain', payload } : { kind: 'none' }
  }
}

// ── Where imported connections land ──────────────────────────────────────────────────────

const IMPORT_GROUP: Record<'compass' | 'dbeaver', string> = { compass: 'Imported from MongoDB Compass', dbeaver: 'Imported from DBeaver' }

/**
 * Put everything another tool's plan brings under one group named after the tool, so what
 * was imported is together and apart from what was already here. The tool's own folders
 * become its subgroups; groups are two levels deep, so a folder inside a folder keeps its
 * path in the subgroup's name ("a / b"). A Ganesha export is left as it is.
 */
export function underImportGroup(plan: ImportPlan): ImportPlan {
  if (plan.source === 'ganesha' || plan.connections.length === 0) return plan
  const ROOT = 'import-root'
  const byId = new Map(plan.groups.map((g) => [g.id, g]))
  const groups: ExportedGroup[] = [{ id: ROOT, name: IMPORT_GROUP[plan.source], parentId: null }]
  // Only folders that hold a connection themselves: a parent kept just for its children would
  // be an empty subgroup once those sit beside it.
  const holding = new Set(plan.connections.map((c) => c.groupId))
  for (const g of plan.groups) {
    if (!holding.has(g.id)) continue
    const parent = g.parentId ? byId.get(g.parentId) : undefined
    groups.push({ id: g.id, name: parent ? `${parent.name} / ${g.name}` : g.name, parentId: ROOT })
  }
  return { ...plan, groups, connections: plan.connections.map((c) => ({ ...c, groupId: c.groupId ?? ROOT })) }
}

// ── Detection ────────────────────────────────────────────────────────────────────────────

/**
 * Work out which tool wrote `text` and parse it. `readCredentials` returns DBeaver's
 * credentials-config.json from next to the picked file (null when there is none); it is only
 * called for a DBeaver file.
 */
export function parseImportFile(text: string, readCredentials: () => Buffer | null): ImportPlan {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This file is not a connections file Ganesha can read') }
  if (isObj(raw) && raw.format === 'ganesha-connections') return planFromTransferFile(parseTransferFile(text))
  if (isObj(raw) && raw.type === COMPASS_TYPE) return underImportGroup(parseCompass(raw))
  if (isObj(raw) && isObj(raw.connections) && Object.values(raw.connections).some((c) => isObj(c) && 'provider' in c && 'configuration' in c)) {
    return underImportGroup(parseDbeaver(raw, readCredentials()))
  }
  throw new Error('This file is not a Ganesha export, a MongoDB Compass export or a DBeaver data-sources.json')
}
