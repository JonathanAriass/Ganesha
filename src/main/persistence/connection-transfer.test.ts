import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection, listConnections, setConnectionGroup } from './connections'
import { createGroup, listGroups } from './groups'
import { makeSecretStore, type Encryptor } from './secrets'
import { buildExport, applyImport, parseTransferFile, encryptSecrets, decryptSecrets } from './connection-transfer'
import type { ConnectionInput } from '../../shared/domain'

const fake: Encryptor = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decrypt: (buf) => buf.toString('utf8').replace(/^enc:/, '')
}
const base: ConnectionInput = {
  type: 'postgres', name: 'prod', color: '#000', host: 'db.internal', port: 5432,
  username: 'app', database: 'main', ssl: true, readOnly: true, requireCommit: true,
  authSource: '', replicaSet: '', ssh: null, repoPath: '/repos/app', environment: 'PROD'
}
const withSsh: ConnectionInput = {
  ...base, type: 'mysql', name: 'tunnelled', port: 3306, repoPath: null,
  ssh: { enabled: true, hops: [{ id: 'hop1', host: 'bastion', port: 22, username: 'me', auth: 'password', keyPath: '' }] }
}
const PASS = 'correct horse'

function fresh(): { db: DB; secrets: ReturnType<typeof makeSecretStore> } {
  const db = new Database(':memory:'); migrate(db)
  return { db, secrets: makeSecretStore(db, fake) }
}

let src: ReturnType<typeof fresh>
let dst: ReturnType<typeof fresh>
beforeEach(() => {
  src = fresh(); dst = fresh()
  const root = createGroup(src.db, 'Work', 1)
  const sub = createGroup(src.db, 'Staging', 2, root.id)
  const a = createConnection(src.db, base, 10)
  const b = createConnection(src.db, withSsh, 20)
  setConnectionGroup(src.db, a.id, root.id, 11)
  setConnectionGroup(src.db, b.id, sub.id, 21)
  src.secrets.setPassword(a.id, 'pw-a')
  src.secrets.setPassword(b.id, 'pw-b')
  src.secrets.setSecret(b.id, 'ssh:hop1', 'ssh-secret')
})

/** Export → JSON text → parse, exactly as it travels through a file. */
function roundTrip(passphrase: string | null, ids: string[] | null = null): ReturnType<typeof parseTransferFile> {
  return parseTransferFile(JSON.stringify(buildExport(src.db, src.secrets, { connectionIds: ids, passphrase }, 100)))
}

describe('connection transfer', () => {
  it('round-trips the environment label', () => {
    applyImport(dst.db, dst.secrets, roundTrip(null), null, 200)
    expect(listConnections(dst.db).find((c) => c.name === 'prod')!.environment).toBe('PROD')
  })

  it.each([
    ['missing', undefined, ''],
    ['non-string', 123, ''],
    ['too long', 'x'.repeat(40), 'x'.repeat(12)]
  ])('imports a %s environment as cleaned', (_n, value, expected) => {
    const file = JSON.parse(JSON.stringify(buildExport(src.db, src.secrets, { connectionIds: null, passphrase: null }, 100)))
    for (const c of file.connections) { if (value === undefined) delete c.environment; else c.environment = value }
    const parsed = parseTransferFile(JSON.stringify(file))
    expect(parsed.connections.every((c) => c.environment === expected)).toBe(true)
  })

  it('round-trips connections, groups and secrets with a passphrase', () => {
    const res = applyImport(dst.db, dst.secrets, roundTrip(PASS), PASS, 200)
    expect(res).toEqual({ imported: 2, skipped: 0, groupsCreated: 2, withSecrets: true })

    const groups = listGroups(dst.db)
    const work = groups.find((g) => g.name === 'Work')!
    const staging = groups.find((g) => g.name === 'Staging')!
    expect(work.parentId).toBeNull()
    expect(staging.parentId).toBe(work.id)

    const conns = listConnections(dst.db)
    const prod = conns.find((c) => c.name === 'prod')!
    const tun = conns.find((c) => c.name === 'tunnelled')!
    expect(prod).toMatchObject({ type: 'postgres', host: 'db.internal', port: 5432, ssl: true, readOnly: true, groupId: work.id })
    expect(tun.groupId).toBe(staging.id)
    expect(tun.ssh).toEqual(withSsh.ssh)
    expect(dst.secrets.getPassword(prod.id)).toBe('pw-a')
    expect(dst.secrets.getPassword(tun.id)).toBe('pw-b')
    expect(dst.secrets.getSecret(tun.id, 'ssh:hop1')).toBe('ssh-secret')
  })

  it('never writes secrets to the file without a passphrase', () => {
    const file = buildExport(src.db, src.secrets, { connectionIds: null, passphrase: null }, 100)
    expect(file.secrets).toBeNull()
    expect(JSON.stringify(file)).not.toMatch(/pw-a|pw-b|ssh-secret/)
    const res = applyImport(dst.db, dst.secrets, file, null, 200)
    expect(res.withSecrets).toBe(false)
    expect(dst.secrets.getPassword(listConnections(dst.db)[0].id)).toBeNull()
  })

  it('keeps secrets unreadable in the file when a passphrase is used', () => {
    const text = JSON.stringify(buildExport(src.db, src.secrets, { connectionIds: null, passphrase: PASS }, 100))
    expect(text).not.toMatch(/pw-a|pw-b|ssh-secret/)
  })

  it('rejects a wrong passphrase and imports nothing', () => {
    expect(() => applyImport(dst.db, dst.secrets, roundTrip(PASS), 'not the one', 200)).toThrow(/wrong passphrase/i)
    expect(listConnections(dst.db)).toHaveLength(0)
    expect(listGroups(dst.db)).toHaveLength(0)
  })

  it('can import a file with secrets while leaving the secrets behind', () => {
    const res = applyImport(dst.db, dst.secrets, roundTrip(PASS), null, 200)
    expect(res).toMatchObject({ imported: 2, withSecrets: false })
    for (const c of listConnections(dst.db)) expect(dst.secrets.getPassword(c.id)).toBeNull()
  })

  it('rejects a short passphrase', () => {
    expect(() => buildExport(src.db, src.secrets, { connectionIds: null, passphrase: 'short' }, 1)).toThrow(/at least/i)
  })

  it('exports only the selected connections and the groups they need', () => {
    const tun = listConnections(src.db).find((c) => c.name === 'tunnelled')!
    const file = roundTrip(null, [tun.id])
    expect(file.connections.map((c) => c.name)).toEqual(['tunnelled'])
    // The subgroup's parent comes along so the nesting survives.
    expect(file.groups.map((g) => g.name).sort()).toEqual(['Staging', 'Work'])
  })

  it('throws when there is nothing to export', () => {
    expect(() => buildExport(dst.db, dst.secrets, { connectionIds: null, passphrase: null }, 1)).toThrow(/no connections/i)
  })

  it('skips connections that already exist and reuses groups by name on re-import', () => {
    const file = roundTrip(null)
    applyImport(dst.db, dst.secrets, file, null, 200)
    const again = applyImport(dst.db, dst.secrets, file, null, 300)
    expect(again).toEqual({ imported: 0, skipped: 2, groupsCreated: 0, withSecrets: false })
    expect(listConnections(dst.db)).toHaveLength(2)
    expect(listGroups(dst.db)).toHaveLength(2)
  })

  it('leaves existing connections and their secrets untouched', () => {
    const mine = createConnection(dst.db, { ...base, name: 'mine' }, 5)
    dst.secrets.setPassword(mine.id, 'keep')
    applyImport(dst.db, dst.secrets, roundTrip(PASS), PASS, 200)
    expect(listConnections(dst.db)).toHaveLength(3)
    expect(dst.secrets.getPassword(mine.id)).toBe('keep')
  })

  it('keeps a linked repo path only when it exists on this machine', () => {
    applyImport(dst.db, dst.secrets, roundTrip(null), null, 200, () => false)
    expect(listConnections(dst.db).find((c) => c.name === 'prod')!.repoPath).toBeNull()
    const other = fresh()
    applyImport(other.db, other.secrets, roundTrip(null), null, 200, (p) => p === '/repos/app')
    expect(listConnections(other.db).find((c) => c.name === 'prod')!.repoPath).toBe('/repos/app')
  })

  it('rejects files that are not connection exports', () => {
    expect(() => parseTransferFile('not json')).toThrow(/not a ganesha/i)
    expect(() => parseTransferFile('{"format":"other"}')).toThrow(/not a ganesha/i)
    expect(() => parseTransferFile(JSON.stringify({ format: 'ganesha-connections', version: 99, groups: [], connections: [] }))).toThrow(/newer version/i)
    expect(() => parseTransferFile(JSON.stringify({ format: 'ganesha-connections', version: 1, groups: [], connections: [{ id: 'x', name: 'n', host: 'h', port: 1, type: 'oracle' }] }))).toThrow(/invalid connection/i)
  })

  it('detects a tampered secrets block', () => {
    const block = encryptSecrets({ a: { db: 'x' } }, PASS)
    expect(decryptSecrets(block, PASS)).toEqual({ a: { db: 'x' } })
    const flipped = Buffer.from(block.data, 'base64'); flipped[0] ^= 1
    expect(() => decryptSecrets({ ...block, data: flipped.toString('base64') }, PASS)).toThrow(/wrong passphrase/i)
  })
})
