import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import type { DB } from './db'
import type { makeSecretStore } from './secrets'
import type { ConnectionInput, ConnectionType, SshConfig, SshHop } from '../../shared/domain'
import { MIN_PASSPHRASE_LENGTH, type ImportResult } from '../../shared/transfer'
import { listConnections, createConnection, setConnectionGroup } from './connections'
import { listGroups, createGroup } from './groups'

type SecretStore = ReturnType<typeof makeSecretStore>

const FORMAT = 'ganesha-connections'
const VERSION = 1
// scrypt cost is fixed (not read from the file) so a crafted file can't demand absurd work.
const KDF = 'scrypt-n32768-r8-p1'
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const TYPES: ConnectionType[] = ['postgres', 'mysql', 'mariadb', 'mongodb']

interface ExportedGroup { id: string; name: string; parentId: string | null }
interface ExportedConnection extends ConnectionInput { id: string; groupId: string | null }

/** Passphrase-encrypted secrets block (AES-256-GCM, key from scrypt). All fields base64. */
interface EncryptedSecrets { kdf: string; salt: string; iv: string; tag: string; data: string }

/** Plaintext shape inside the encrypted block, keyed by the file's connection ids. */
type SecretsPayload = Record<string, { db?: string; ssh?: Record<string, string> }>

export interface TransferFile {
  format: typeof FORMAT
  version: number
  exportedAt: number
  groups: ExportedGroup[]
  connections: ExportedConnection[]
  /** null = the file carries no passwords or SSH secrets. */
  secrets: EncryptedSecrets | null
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, 32, SCRYPT)
}

export function encryptSecrets(payload: SecretsPayload, passphrase: string): EncryptedSecrets {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    kdf: KDF, salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
  }
}

export function decryptSecrets(block: EncryptedSecrets, passphrase: string): SecretsPayload {
  if (block.kdf !== KDF) throw new Error('This file uses an unsupported encryption scheme')
  let plain: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, Buffer.from(block.salt, 'base64')), Buffer.from(block.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(block.tag, 'base64'))
    plain = Buffer.concat([decipher.update(Buffer.from(block.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // GCM authentication failed: wrong passphrase (or a tampered file).
    throw new Error('Wrong passphrase')
  }
  return JSON.parse(plain) as SecretsPayload
}

/**
 * Build the export file for the given connections (null = all of them), plus the groups
 * they sit in (and those groups' parents). Secrets are read from the store only when a
 * passphrase is given, and leave this function already encrypted.
 */
export function buildExport(
  db: DB, secrets: SecretStore, opts: { connectionIds: string[] | null; passphrase: string | null }, now: number
): TransferFile {
  if (opts.passphrase !== null && opts.passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
  }
  const wanted = opts.connectionIds ? new Set(opts.connectionIds) : null
  const all = listGroups(db)
  const byId = new Map(all.map((g) => [g.id, g]))
  // Oldest first, so an import (which appends) recreates the same order.
  const picked = listConnections(db).filter((c) => !wanted || wanted.has(c.id)).reverse()
  if (picked.length === 0) throw new Error('No connections to export')

  const groupIds = new Set<string>()
  for (const c of picked) {
    const g = c.groupId ? byId.get(c.groupId) : undefined
    if (!g) continue
    groupIds.add(g.id)
    if (g.parentId && byId.has(g.parentId)) groupIds.add(g.parentId)
  }

  const connections: ExportedConnection[] = picked.map((c) => {
    const { createdAt: _c, updatedAt: _u, ...rest } = c
    return { ...rest, groupId: c.groupId && groupIds.has(c.groupId) ? c.groupId : null }
  })

  let block: EncryptedSecrets | null = null
  if (opts.passphrase !== null) {
    const payload: SecretsPayload = {}
    for (const c of picked) {
      const entry: SecretsPayload[string] = {}
      const pw = secrets.getPassword(c.id)
      if (pw !== null) entry.db = pw
      for (const hop of c.ssh?.hops ?? []) {
        const s = secrets.getSecret(c.id, `ssh:${hop.id}`)
        if (s !== null) (entry.ssh ??= {})[hop.id] = s
      }
      if (entry.db !== undefined || entry.ssh) payload[c.id] = entry
    }
    block = encryptSecrets(payload, opts.passphrase)
  }

  return {
    format: FORMAT, version: VERSION, exportedAt: now,
    // listGroups is position-ordered, so groups keep their dashboard order in the file.
    groups: all.filter((g) => groupIds.has(g.id)).map((g) => ({ id: g.id, name: g.name, parentId: g.parentId })),
    connections,
    secrets: block
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseSsh(v: unknown): SshConfig | null {
  if (!isObj(v) || !Array.isArray(v.hops)) return null
  const hops: SshHop[] = []
  for (const h of v.hops) {
    if (!isObj(h) || typeof h.id !== 'string' || typeof h.host !== 'string') throw new Error('Invalid SSH hop in file')
    hops.push({
      id: h.id, host: h.host, port: typeof h.port === 'number' ? h.port : 22,
      username: str(h.username), auth: h.auth === 'password' ? 'password' : 'key', keyPath: str(h.keyPath)
    })
  }
  return { enabled: v.enabled === true, hops }
}

/** Parse + validate the text of an export file. Every field is rebuilt from scratch, so
 *  nothing unexpected in a hand-edited or hostile file reaches the database. */
export function parseTransferFile(text: string): TransferFile {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Not a Ganesha connections file') }
  if (!isObj(raw) || raw.format !== FORMAT) throw new Error('Not a Ganesha connections file')
  if (raw.version !== VERSION) throw new Error('This file was made by a newer version of Ganesha')
  if (!Array.isArray(raw.connections) || !Array.isArray(raw.groups)) throw new Error('Connections file is malformed')

  const groups: ExportedGroup[] = raw.groups.map((g) => {
    if (!isObj(g) || typeof g.id !== 'string' || typeof g.name !== 'string') throw new Error('Invalid group in file')
    return { id: g.id, name: g.name, parentId: typeof g.parentId === 'string' ? g.parentId : null }
  })
  const connections: ExportedConnection[] = raw.connections.map((c) => {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.host !== 'string'
      || typeof c.port !== 'number' || !TYPES.includes(c.type as ConnectionType)) {
      throw new Error('Invalid connection in file')
    }
    return {
      id: c.id, type: c.type as ConnectionType, name: c.name, color: str(c.color, '#6366f1'),
      host: c.host, port: c.port, username: str(c.username), database: str(c.database),
      ssl: c.ssl === true, readOnly: c.readOnly === true, requireCommit: c.requireCommit === true,
      authSource: str(c.authSource), replicaSet: str(c.replicaSet), ssh: parseSsh(c.ssh),
      repoPath: typeof c.repoPath === 'string' ? c.repoPath : null,
      groupId: typeof c.groupId === 'string' ? c.groupId : null
    }
  })

  let secrets: EncryptedSecrets | null = null
  if (raw.secrets !== null && raw.secrets !== undefined) {
    const s = raw.secrets
    if (!isObj(s) || [s.kdf, s.salt, s.iv, s.tag, s.data].some((f) => typeof f !== 'string')) {
      throw new Error('Connections file is malformed')
    }
    secrets = s as unknown as EncryptedSecrets
  }
  return { format: FORMAT, version: VERSION, exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0, groups, connections, secrets }
}

const groupKey = (name: string, parentId: string | null): string => `${parentId ?? ''}\u0000${name.toLowerCase()}`
const connKey = (c: ConnectionInput): string =>
  [c.type, c.name, c.host, c.port, c.username, c.database].join('\u0000').toLowerCase()

/**
 * Add a parsed file's connections to this installation. Nothing existing is modified:
 * connections that already exist here (same type/name/host/port/user/database) are skipped,
 * and groups are matched by name (under the same parent) or created. All-or-nothing.
 *
 * passphrase null = import without secrets even if the file has them.
 * repoPathExists decides whether a linked-repo path is kept (it is machine-specific).
 */
export function applyImport(
  db: DB, secrets: SecretStore, file: TransferFile, passphrase: string | null, now: number,
  repoPathExists: (path: string) => boolean = () => false
): ImportResult {
  // Decrypt first: a wrong passphrase must fail before anything is written.
  const payload = file.secrets && passphrase !== null ? decryptSecrets(file.secrets, passphrase) : null

  const run = db.transaction((): ImportResult => {
    const existingGroups = new Map(listGroups(db).map((g) => [groupKey(g.name, g.parentId), g.id]))
    const groupMap = new Map<string, string>() // file group id → local group id
    let groupsCreated = 0
    const place = (g: ExportedGroup, localParent: string | null): void => {
      const key = groupKey(g.name.trim(), localParent)
      let id = existingGroups.get(key)
      if (!id) {
        id = createGroup(db, g.name, now, localParent).id
        existingGroups.set(key, id)
        groupsCreated++
      }
      groupMap.set(g.id, id)
    }
    const fileGroupIds = new Set(file.groups.map((g) => g.id))
    // Roots first (a subgroup whose parent isn't in the file becomes a root), then subgroups.
    for (const g of file.groups) if (g.parentId === null || !fileGroupIds.has(g.parentId)) place(g, null)
    for (const g of file.groups) {
      if (groupMap.has(g.id)) continue
      const parent = groupMap.get(g.parentId as string)
      // Local parent is itself a subgroup (name clash with the 2-level cap) → fall back to root.
      const parentIsRoot = parent !== undefined && listGroups(db).find((x) => x.id === parent)?.parentId === null
      place(g, parentIsRoot ? (parent as string) : null)
    }

    const existing = new Set(listConnections(db).map(connKey))
    let imported = 0
    let skipped = 0
    for (const c of file.connections) {
      const { id: fileId, groupId, ...input } = c
      if (existing.has(connKey(input))) { skipped++; continue }
      existing.add(connKey(input))
      const repoPath = input.repoPath && repoPathExists(input.repoPath) ? input.repoPath : null
      const created = createConnection(db, { ...input, repoPath }, now)
      const localGroup = groupId ? groupMap.get(groupId) : undefined
      if (localGroup) setConnectionGroup(db, created.id, localGroup, now)
      const entry = payload?.[fileId]
      if (entry) {
        if (typeof entry.db === 'string') secrets.setPassword(created.id, entry.db)
        for (const hop of input.ssh?.hops ?? []) {
          const s = entry.ssh?.[hop.id]
          if (typeof s === 'string') secrets.setSecret(created.id, `ssh:${hop.id}`, s)
        }
      }
      imported++
    }
    return { imported, skipped, groupsCreated, withSecrets: payload !== null }
  })
  return run()
}
