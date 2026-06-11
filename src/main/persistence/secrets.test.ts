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
  username: 'u', database: 'd', ssl: false, readOnly: false,
  authSource: '', replicaSet: ''
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
