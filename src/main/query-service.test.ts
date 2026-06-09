import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './persistence/db'
import { createConnection } from './persistence/connections'
import { makeSecretStore, type Encryptor } from './persistence/secrets'
import { listHistory } from './persistence/history'
import { runUserQuery } from './query-service'
import type { DatabaseDriver, QueryResult } from './drivers/types'
import type { ConnectionInput } from '../shared/domain'

const enc: Encryptor = { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() }
const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 5432,
  username: 'u', database: 'd', ssl: false, readOnly: true
}
const fakeResult: QueryResult = {
  columns: [{ name: 'n', dataType: '23' }], rows: [[1]], rowCount: 1, durationMs: 3, truncated: false, documents: null
}

function fakeDriver(calls: string[]): DatabaseDriver {
  return {
    type: 'postgres',
    testConnection: async () => {},
    connect: async () => { calls.push('connect') },
    disconnect: async () => {},
    runQuery: async (_id, req) => { calls.push('run:' + (req.kind === 'sql' ? req.sql : 'mongo')); return fakeResult },
    cancel: async () => {}
  }
}

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('runUserQuery', () => {
  it('runs a read on a read-only connection, returns the result, and logs history', async () => {
    const calls: string[] = []
    const c = createConnection(db, input, 1)
    const secrets = makeSecretStore(db, enc)
    secrets.setPassword(c.id, 'pw')
    const res = await runUserQuery({
      db, secrets, driver: fakeDriver(calls), connectionId: c.id, sql: 'SELECT 1', now: () => 42
    })
    expect(res).toEqual(fakeResult)
    expect(calls).toEqual(['connect', 'run:SELECT 1'])
    const hist = listHistory(db, c.id)
    expect(hist).toHaveLength(1)
    expect(hist[0].query).toBe('SELECT 1')
    expect(hist[0].success).toBe(true)
  })

  it('blocks a write on a read-only connection BEFORE the driver runs, and logs the failure', async () => {
    const calls: string[] = []
    const c = createConnection(db, input, 1)
    await expect(
      runUserQuery({ db, secrets: makeSecretStore(db, enc), driver: fakeDriver(calls), connectionId: c.id, sql: 'DELETE FROM t', now: () => 42 })
    ).rejects.toThrow(/read-only/i)
    expect(calls).toEqual(['connect']) // driver.runQuery NOT called
    expect(listHistory(db, c.id)[0].success).toBe(false)
  })

  it('throws if the connection id is unknown', async () => {
    await expect(
      runUserQuery({ db, secrets: makeSecretStore(db, enc), driver: fakeDriver([]), connectionId: 'nope', sql: 'SELECT 1', now: () => 1 })
    ).rejects.toThrow(/not found/i)
  })
})
