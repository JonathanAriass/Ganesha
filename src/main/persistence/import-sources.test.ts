import { describe, it, expect } from 'vitest'
import { createCipheriv, pbkdf2Sync, randomBytes } from 'crypto'
import Database from 'better-sqlite3'
import { migrate } from './db'
import { listConnections } from './connections'
import { listGroups } from './groups'
import { makeSecretStore, type Encryptor } from './secrets'
import { applyPlan, type ImportPlan, type SecretsPayload } from './connection-transfer'
import { parseImportFile, parseMongoUri, decryptCompassSecrets, decryptDbeaverCredentials, underImportGroup, parseCompassStore, compassStoreKey } from './import-sources'

const fake: Encryptor = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decrypt: (buf) => buf.toString('utf8').replace(/^enc:/, '')
}
function fresh(): { db: InstanceType<typeof Database>; secrets: ReturnType<typeof makeSecretStore> } {
  const db = new Database(':memory:'); migrate(db)
  return { db, secrets: makeSecretStore(db, fake) }
}
const none = (): Buffer | null => null
const plainOf = (plan: ImportPlan): SecretsPayload => {
  if (plan.secrets.kind !== 'plain') throw new Error(`expected plain secrets, got ${plan.secrets.kind}`)
  return plan.secrets.payload
}

/** What Compass writes for one connection's secrets when exporting with a passphrase. */
function compassEncrypt(secrets: Record<string, string>, passphrase: string): string {
  const salt = randomBytes(16); const iv = randomBytes(16)
  const c = createCipheriv('aes-256-gcm', pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, 100000, 32, 'sha512'), iv)
  const data = Buffer.concat([c.update(JSON.stringify({ secrets }), 'utf8'), c.final()])
  return Buffer.concat([Buffer.from([0, 1]), salt, iv, c.getAuthTag(), data]).toString('base64')
}
/** What DBeaver writes as credentials-config.json. */
function dbeaverEncrypt(creds: unknown, key = 'babb4a9f774ab853c96c2d653dfe544a'): Buffer {
  const iv = randomBytes(16)
  const c = createCipheriv('aes-128-cbc', Buffer.from(key, 'hex'), iv)
  return Buffer.concat([iv, c.update(JSON.stringify(creds), 'utf8'), c.final()])
}

const compassFile = (connections: unknown[]): string =>
  JSON.stringify({ type: 'Compass Connections', version: { $numberInt: '1' }, connections })

describe('parseMongoUri', () => {
  it('reads user, password, host, port, database and options', () => {
    const u = parseMongoUri('mongodb://app:p%40ss%3Aword@db.internal:27018/shop?authSource=admin&replicaSet=rs0&tls=true')!
    expect(u).toMatchObject({ srv: false, username: 'app', password: 'p@ss:word', database: 'shop', hosts: [{ host: 'db.internal', port: 27018 }] })
    expect(u.params.get('authSource')).toBe('admin')
  })
  it('handles several hosts, no port, no path, and IPv6', () => {
    expect(parseMongoUri('mongodb://a:1,b/?replicaSet=x')!.hosts).toEqual([{ host: 'a', port: 1 }, { host: 'b', port: 27017 }])
    expect(parseMongoUri('mongodb://localhost')).toMatchObject({ username: '', password: '', database: '' })
    expect(parseMongoUri('mongodb://[::1]:27019/db')!.hosts).toEqual([{ host: '[::1]', port: 27019 }])
    expect(parseMongoUri('mongodb://u@h?tls=true')!.params.get('tls')).toBe('true')
  })
  it('flags srv addresses and rejects other schemes', () => {
    expect(parseMongoUri('mongodb+srv://u:p@cluster0.example.net/db')!.srv).toBe(true)
    expect(parseMongoUri('postgres://h/db')).toBeNull()
    expect(parseMongoUri('mongodb://')).toBeNull()
  })
})

describe('MongoDB Compass import', () => {
  const conn = {
    id: 'c1', favorite: { name: 'Shop', color: 'color6' }, savedConnectionType: 'favorite',
    connectionOptions: {
      connectionString: 'mongodb://app:secret@db.internal:27018/shop?authSource=admin&replicaSet=rs0&tls=true',
      sshTunnel: { host: 'bastion', port: { $numberInt: '2222' }, username: 'me', password: 'sshpw' }
    }
  }

  it('maps a connection, its colour, its tunnel and its clear-text secrets', () => {
    const plan = parseImportFile(compassFile([conn]), none)
    expect(plan.source).toBe('compass')
    expect(plan.connections).toEqual([expect.objectContaining({
      type: 'mongodb', name: 'Shop', color: '#ef4444', host: 'db.internal', port: 27018, username: 'app', database: 'shop',
      ssl: true, authSource: 'admin', replicaSet: 'rs0',
      ssh: { enabled: true, hops: [{ id: 'ssh', host: 'bastion', port: 2222, username: 'me', auth: 'password', keyPath: '' }] }
    })])
    expect(plainOf(plan)).toEqual({ c1: { db: 'secret', ssh: { ssh: 'sshpw' } } })
  })

  it('uses the key file and its passphrase for a key-based tunnel', () => {
    const plan = parseImportFile(compassFile([{
      id: 'k', connectionOptions: { connectionString: 'mongodb://h', sshTunnel: { host: 'b', port: 22, username: 'u', identityKeyFile: ['/keys/id'], identityKeyPassphrase: 'kp' } }
    }]), none)
    expect(plan.connections[0].ssh?.hops[0]).toMatchObject({ auth: 'key', keyPath: '/keys/id' })
    expect(plan.connections[0].name).toBe('h:27017') // a recent connection has no favourite name
    expect(plainOf(plan)).toEqual({ k: { ssh: { ssh: 'kp' } } })
  })

  it('reports no secrets when the export removed them', () => {
    const plan = parseImportFile(compassFile([{ id: 'x', connectionOptions: { connectionString: 'mongodb://app@h/db' } }]), none)
    expect(plan.secrets.kind).toBe('none')
    expect(plan.connections[0].username).toBe('app')
  })

  it('decrypts a passphrase-protected export, and rejects a wrong passphrase', () => {
    const protectedConn = {
      id: 'c1', favorite: { name: 'Shop' },
      connectionOptions: { connectionString: 'mongodb://app@db.internal:27018/shop', sshTunnel: { host: 'bastion', port: 22, username: 'me' } },
      connectionSecrets: compassEncrypt({ password: 'secret', sshTunnelPassword: 'sshpw' }, 'open sesame')
    }
    const plan = parseImportFile(compassFile([protectedConn]), none)
    if (plan.secrets.kind !== 'encrypted') throw new Error('expected encrypted secrets')
    expect(plan.secrets.decrypt('open sesame')).toEqual({ c1: { db: 'secret', ssh: { ssh: 'sshpw' } } })
    expect(() => (plan.secrets as { decrypt: (p: string) => unknown }).decrypt('nope')).toThrow('Wrong passphrase')
    expect(() => decryptCompassSecrets('AAAA', 'x')).toThrow('unsupported')
  })

  it('leaves out srv addresses and unreadable entries, saying why', () => {
    const plan = parseImportFile(compassFile([
      conn,
      { id: 's', favorite: { name: 'Atlas' }, connectionOptions: { connectionString: 'mongodb+srv://u:p@cluster0.example.net/db' } },
      { id: 'bad', connectionOptions: { connectionString: 'nonsense' } },
      'garbage'
    ]), none)
    expect(plan.connections.map((c) => c.name)).toEqual(['Shop'])
    expect(plan.skipped).toEqual([
      { name: 'Atlas', reason: 'mongodb+srv addresses are not supported' },
      { name: 'Connection 3', reason: 'No MongoDB address' },
      { name: 'Connection 4', reason: 'Unreadable entry' }
    ])
  })

  it('rejects a newer Compass format', () => {
    expect(() => parseImportFile(JSON.stringify({ type: 'Compass Connections', version: 2, connections: [] }), none)).toThrow('newer version of Compass')
  })
})

describe('DBeaver import', () => {
  const sources = {
    folders: { Work: {}, 'Work/Staging': {} },
    connections: {
      'mysql8-1': {
        provider: 'mysql', driver: 'mysql8', name: 'Orders', 'save-password': true, folder: 'Work/Staging', 'read-only': true,
        configuration: {
          host: 'localhost', port: '13306', database: 'orders', url: 'jdbc:mysql://localhost:13306/orders', configurationType: 'MANUAL', type: 'prod',
          handlers: {
            ssh_tunnel: {
              type: 'TUNNEL', enabled: true, 'save-password': true,
              properties: {
                'jumpServer0.host': 'jump', 'jumpServer0.port': 2200.0, 'jumpServer0.name': 'jumper', 'jumpServer0.authType': 'PUBLIC_KEY',
                'jumpServer0.keyPath': '/keys/jump', 'jumpServer0.enabled': true, 'jumpServer.count': 1.0,
                host: 'bastion', port: 22.0, authType: 'PASSWORD', implementation: 'sshj'
              }
            }
          }
        }
      },
      'mariaDB-2': { provider: 'mysql', driver: 'mariaDB', name: 'Legacy', configuration: { host: 'maria', port: '3307', database: 'old', type: 'dev' } },
      'postgres-jdbc-3': {
        provider: 'postgresql', driver: 'postgres-jdbc', name: 'Analytics',
        configuration: { url: 'jdbc:postgresql://pg.internal:5433/analytics', configurationType: 'URL', properties: { sslmode: 'require' }, type: 'test' }
      },
      'sqlite_jdbc-4': { provider: 'sqlite', driver: 'sqlite_jdbc', name: 'Local file', configuration: { database: '/tmp/x.db' } },
      'postgres-jdbc-5': { provider: 'postgresql', driver: 'postgres-jdbc', name: 'Empty', configuration: {} }
    }
  }
  const credentials = dbeaverEncrypt({
    'mysql8-1': { '#connection': { user: 'root', password: 'dbpw' }, 'network/ssh_tunnel': { user: 'ops', password: 'sshpw' } },
    'mariaDB-2': { '#connection': { user: 'legacy', password: '' } },
    'postgres-jdbc-3': { '#connection': { user: 'analyst', password: 'pgpw' } }
  })
  const text = JSON.stringify(sources)

  it('maps engines, addresses, folders, the tunnel chain and the credentials file', () => {
    const plan = parseImportFile(text, () => credentials)
    expect(plan.source).toBe('dbeaver')
    expect(plan.notes).toEqual([])
    expect(plan.connections.map((c) => [c.type, c.name, c.host, c.port, c.username, c.database, c.environment])).toEqual([
      ['mysql', 'Orders', 'localhost', 13306, 'root', 'orders', 'PROD'],
      ['mariadb', 'Legacy', 'maria', 3307, 'legacy', 'old', ''],
      ['postgres', 'Analytics', 'pg.internal', 5433, 'analyst', 'analytics', 'TEST']
    ])
    expect(plan.connections[0]).toMatchObject({ readOnly: true, ssl: false })
    expect(plan.connections[2].ssl).toBe(true)
    expect(plan.connections[0].ssh).toEqual({
      enabled: true,
      hops: [
        { id: 'jump0', host: 'jump', port: 2200, username: 'jumper', auth: 'key', keyPath: '/keys/jump' },
        { id: 'ssh', host: 'bastion', port: 22, username: 'ops', auth: 'password', keyPath: '' }
      ]
    })
    expect(plan.groups).toEqual([
      { id: 'import-root', name: 'Imported from DBeaver', parentId: null },
      { id: 'folder-1', name: 'Work / Staging', parentId: 'import-root' }
    ])
    expect(plan.connections[0].groupId).toBe('folder-1')
    expect(plainOf(plan)).toEqual({
      'mysql8-1': { db: 'dbpw', ssh: { ssh: 'sshpw' } },
      'postgres-jdbc-3': { db: 'pgpw' }
    })
    expect(plan.skipped).toEqual([
      { name: 'Local file', reason: 'sqlite is not supported' },
      { name: 'Empty', reason: 'No host' }
    ])
  })

  it('imports without credentials when the file is missing, and says so', () => {
    const plan = parseImportFile(text, none)
    expect(plan.secrets.kind).toBe('none')
    expect(plan.connections[0].username).toBe('')
    expect(plan.notes[0]).toMatch(/No credentials-config\.json/)
  })

  it('imports without credentials when the project has a master password, and says so', () => {
    const locked = dbeaverEncrypt({ any: {} }, '00112233445566778899aabbccddeeff')
    expect(decryptDbeaverCredentials(locked)).toBeNull()
    const plan = parseImportFile(text, () => locked)
    expect(plan.secrets.kind).toBe('none')
    expect(plan.notes[0]).toMatch(/master password/)
    expect(plan.connections).toHaveLength(3)
  })

  it('folds folders deeper than two levels into the subgroup name', () => {
    const deep = JSON.stringify({ connections: { a: { provider: 'mysql', driver: 'mysql8', name: 'A', folder: 'x/y/z', configuration: { host: 'h' } } } })
    expect(parseImportFile(deep, none).groups.map((g) => g.name)).toEqual(['Imported from DBeaver', 'x / y / z'])
  })
})

describe('applying a foreign plan', () => {
  it('creates connections, groups and secrets, and skips what is already here', () => {
    const { db, secrets } = fresh()
    const plan = parseImportFile(JSON.stringify({
      connections: {
        a: { provider: 'mysql', driver: 'mysql8', name: 'A', folder: 'Team', configuration: { host: 'h', port: '3306', handlers: { ssh_tunnel: { enabled: true, properties: { host: 'b', port: 22, authType: 'PASSWORD' } } } } }
      }
    }), () => dbeaverEncrypt({ a: { '#connection': { user: 'u', password: 'pw' }, 'network/ssh_tunnel': { user: 's', password: 'spw' } } }))

    expect(applyPlan(db, secrets, plan, { passphrase: null, includeSecrets: true }, 1)).toEqual({ imported: 1, skipped: 0, groupsCreated: 2, withSecrets: true })
    const [c] = listConnections(db)
    expect(c).toMatchObject({ name: 'A', username: 'u', importedFrom: 'dbeaver' })
    expect(listGroups(db).map((g) => g.name).sort()).toEqual(['Imported from DBeaver', 'Team'])
    expect(c.groupId).toBe(listGroups(db).find((g) => g.name === 'Team')!.id)
    expect(secrets.getPassword(c.id)).toBe('pw')
    expect(secrets.getSecret(c.id, `ssh:${c.ssh!.hops[0].id}`)).toBe('spw')

    expect(applyPlan(db, secrets, plan, { passphrase: null, includeSecrets: true }, 2)).toMatchObject({ imported: 0, skipped: 1, groupsCreated: 0 })
  })

  it('leaves passwords behind when asked to', () => {
    const { db, secrets } = fresh()
    const plan = parseImportFile(compassFile([{ id: 'c', connectionOptions: { connectionString: 'mongodb://u:pw@h/db' } }]), none)
    expect(applyPlan(db, secrets, plan, { passphrase: null, includeSecrets: false }, 1).withSecrets).toBe(false)
    expect(secrets.getPassword(listConnections(db)[0].id)).toBeNull()
  })

  it('writes nothing when the passphrase is wrong', () => {
    const { db, secrets } = fresh()
    const plan = parseImportFile(compassFile([{
      id: 'c', connectionOptions: { connectionString: 'mongodb://u@h/db' }, connectionSecrets: compassEncrypt({ password: 'pw' }, 'right')
    }]), none)
    expect(() => applyPlan(db, secrets, plan, { passphrase: 'wrong', includeSecrets: true }, 1)).toThrow('Wrong passphrase')
    expect(listConnections(db)).toEqual([])
    expect(applyPlan(db, secrets, plan, { passphrase: 'right', includeSecrets: true }, 1).withSecrets).toBe(true)
    expect(secrets.getPassword(listConnections(db)[0].id)).toBe('pw')
  })
})

describe('detection', () => {
  it('rejects files it does not know', () => {
    expect(() => parseImportFile('not json', none)).toThrow('not a connections file')
    expect(() => parseImportFile('{"connections":{}}', none)).toThrow('not a Ganesha export')
    expect(() => parseImportFile('[1,2]', none)).toThrow('not a Ganesha export')
  })
})

describe('underImportGroup', () => {
  const conn = (id: string, groupId: string | null) => ({ id, groupId }) as unknown as ImportPlan['connections'][number]
  const plan = (over: Partial<ImportPlan>): ImportPlan => ({ source: 'dbeaver', groups: [], connections: [], secrets: { kind: 'none' }, skipped: [], notes: [], ...over })

  it('puts loose connections in a group named after the tool', () => {
    const out = underImportGroup(plan({ connections: [conn('a', null)] }))
    expect(out.groups).toEqual([{ id: 'import-root', name: 'Imported from DBeaver', parentId: null }])
    expect(out.connections[0].groupId).toBe('import-root')
  })

  it('turns the tool folders into subgroups, keeping a nested folder path in the name', () => {
    const out = underImportGroup(plan({
      groups: [{ id: 'f0', name: 'Work', parentId: null }, { id: 'f1', name: 'Prod', parentId: 'f0' }],
      connections: [conn('a', 'f0'), conn('b', 'f1')]
    }))
    expect(out.groups.slice(1)).toEqual([
      { id: 'f0', name: 'Work', parentId: 'import-root' },
      { id: 'f1', name: 'Work / Prod', parentId: 'import-root' }
    ])
    const onlyNested = underImportGroup(plan({
      groups: [{ id: 'f0', name: 'Work', parentId: null }, { id: 'f1', name: 'Prod', parentId: 'f0' }],
      connections: [conn('b', 'f1')]
    }))
    expect(onlyNested.groups.map((g) => g.name)).toEqual(['Imported from DBeaver', 'Work / Prod'])
    expect(out.connections.map((c) => c.groupId)).toEqual(['f0', 'f1'])
  })

  it('names the Compass group, and leaves a Ganesha export and an empty plan alone', () => {
    expect(underImportGroup(plan({ source: 'compass', connections: [conn('a', null)] })).groups[0].name).toBe('Imported from MongoDB Compass')
    const own = plan({ source: 'ganesha', connections: [conn('a', null)] })
    expect(underImportGroup(own)).toBe(own)
    const empty = plan({})
    expect(underImportGroup(empty)).toBe(empty)
  })
})

describe('Compass saved connections (keychain)', () => {
  /** What Compass writes on macOS: "v10" + AES-128-CBC with an IV of spaces. */
  const storeEncrypt = (secrets: unknown, keychainPassword: string): string => {
    const c = createCipheriv('aes-128-cbc', compassStoreKey(keychainPassword), Buffer.alloc(16, ' '))
    return Buffer.concat([Buffer.from('v10'), c.update(JSON.stringify(secrets), 'utf8'), c.final()]).toString('base64')
  }
  const entry = (id: string, uri: string, secrets: unknown, tunnel?: Record<string, unknown>): unknown => ({
    connectionInfo: { id, favorite: { name: id }, connectionOptions: { connectionString: uri, ...(tunnel ? { sshTunnel: tunnel } : {}) } },
    connectionSecrets: storeEncrypt(secrets, 'kc-pass')
  })
  const entries = [
    entry('a', 'mongodb://u@h1:27017/app', { password: 'p%40w%2Fa' }),
    entry('b', 'mongodb://u@h2/app', { password: 'pw-b', sshTunnelPassphrase: 'phrase' }, { host: 'bastion', port: 22, username: 'ops', identityKeyFile: '/k' }),
    entry('c', 'mongodb://h3/app', {})
  ]

  it('decrypts database and SSH secrets with the keychain password', () => {
    const plan = parseCompassStore(entries, { keychain: true })
    if (plan.secrets.kind !== 'keychain') throw new Error('expected keychain secrets')
    expect(plan.secrets.service).toBe('MongoDB Compass Safe Storage')
    expect(plan.secrets.decrypt('kc-pass')).toEqual({ a: { db: 'p@w/a' }, b: { db: 'pw-b', ssh: { ssh: 'phrase' } } })
    expect(() => (plan.secrets as { decrypt: (p: string) => unknown }).decrypt('wrong')).toThrow(/could not be decrypted/)
  })

  it('stores them on import only when the keychain password is supplied', () => {
    const plan = parseCompassStore(entries, { keychain: true })
    const a = fresh()
    expect(applyPlan(a.db, a.secrets, plan, { passphrase: null, includeSecrets: true, keychainPassword: 'kc-pass' }, 1)).toMatchObject({ imported: 3, withSecrets: true })
    const byName = new Map(listConnections(a.db).map((c) => [c.name, c]))
    expect(a.secrets.getPassword(byName.get('a')!.id)).toBe('p@w/a')
    expect(a.secrets.getSecret(byName.get('b')!.id, 'ssh:ssh')).toBe('phrase')
    expect(a.secrets.getPassword(byName.get('c')!.id)).toBeNull()

    const b = fresh()
    expect(applyPlan(b.db, b.secrets, plan, { passphrase: null, includeSecrets: false }, 1)).toMatchObject({ imported: 3, withSecrets: false })
    expect(b.secrets.getPassword(listConnections(b.db)[0].id)).toBeNull()
  })

  it('does not offer the keychain off macOS', () => {
    const plan = parseCompassStore(entries)
    expect(plan.secrets.kind).toBe('none')
    expect(plan.notes[0]).toMatch(/keychain/)
  })
})
