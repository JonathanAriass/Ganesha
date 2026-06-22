import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection } from './connections'
import { makeSecretStore, resolveTestPassword, type Encryptor } from './secrets'
import type { ConnectionInput } from '../../shared/domain'

// Reversible fake encryptor: prove the store round-trips without relying on the OS.
const fake: Encryptor = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decrypt: (buf) => buf.toString('utf8').replace(/^enc:/, '')
}
const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false, requireCommit: true,
  authSource: '', replicaSet: '', ssh: null, repoPath: null
}

let db: DB
let store: ReturnType<typeof makeSecretStore>
beforeEach(() => {
  db = new Database(':memory:'); migrate(db)
  store = makeSecretStore(db, fake)
})

describe('secret store', () => {
  it('stores and retrieves a password (encrypted at rest)', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 's3cret')
    const raw = db.prepare('SELECT ciphertext FROM secrets WHERE connection_id=?').get(c.id) as { ciphertext: Buffer }
    expect(raw.ciphertext.toString('utf8')).toBe('enc:s3cret') // not plaintext
    expect(store.getPassword(c.id)).toBe('s3cret')
  })

  it('returns null when no password is stored', () => {
    const c = createConnection(db, input, 1)
    expect(store.getPassword(c.id)).toBeNull()
  })

  it('overwrites an existing password', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'a'); store.setPassword(c.id, 'b')
    expect(store.getPassword(c.id)).toBe('b')
  })

  it('deletes a password', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'x'); store.deletePassword(c.id)
    expect(store.getPassword(c.id)).toBeNull()
  })
})

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

describe('resolveTestPassword', () => {
  it('a typed password wins, even over a stored one', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'stored')
    expect(resolveTestPassword('typed', c.id, store)).toBe('typed')
  })

  it('an explicit empty string is a value, not absence (?? not ||)', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'stored')
    expect(resolveTestPassword('', c.id, store)).toBe('')
  })

  it('blank on edit falls back to the stored secret', () => {
    const c = createConnection(db, input, 1)
    store.setPassword(c.id, 'stored')
    expect(resolveTestPassword(null, c.id, store)).toBe('stored')
  })

  it('blank on edit with no stored secret tests with no password', () => {
    const c = createConnection(db, input, 1)
    expect(resolveTestPassword(null, c.id, store)).toBeNull()
  })

  it('blank on create (no id) tests with no password', () => {
    expect(resolveTestPassword(null, undefined, store)).toBeNull()
  })
})
