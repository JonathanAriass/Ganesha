import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createSsmTunnel, listSsmTunnels, getSsmTunnel, updateSsmTunnel, deleteSsmTunnel } from './ssm-tunnels'
import { createConnection } from './connections'
import type { SsmTunnelInput, ConnectionInput } from '../../shared/domain'

const input: SsmTunnelInput = {
  name: 'swan prod', profile: 'jonathan@okticket', region: 'eu-west-3',
  instanceId: 'i-00c1e3074e28c493a', remotePort: 3306, localPort: 13306, connectionId: null
}
const conn: ConnectionInput = {
  type: 'mysql', name: 'c', color: '#000', host: 'h', port: 1, username: 'u', database: 'd',
  ssl: false, readOnly: false, requireCommit: true, authSource: '', replicaSet: '', ssh: null, repoPath: null
}

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('ssm tunnels persistence', () => {
  it('creates and reads back a tunnel', () => {
    const t = createSsmTunnel(db, input, 1000)
    expect(t.id).toMatch(/.+/)
    expect(t.createdAt).toBe(1000)
    expect(getSsmTunnel(db, t.id)).toEqual(t)
    expect(t).toMatchObject({ name: 'swan prod', instanceId: 'i-00c1e3074e28c493a', localPort: 13306 })
  })
  it('lists oldest-first', () => {
    createSsmTunnel(db, { ...input, name: 'a' }, 1000)
    createSsmTunnel(db, { ...input, name: 'b' }, 2000)
    expect(listSsmTunnels(db).map((t) => t.name)).toEqual(['a', 'b'])
  })
  it('updates fields and bumps updated_at', () => {
    const t = createSsmTunnel(db, input, 1000)
    const u = updateSsmTunnel(db, t.id, { localPort: 23306, name: 'renamed' }, 5000)
    expect(u).toMatchObject({ localPort: 23306, name: 'renamed', updatedAt: 5000, createdAt: 1000 })
  })
  it('deletes a tunnel', () => {
    const t = createSsmTunnel(db, input, 1)
    deleteSsmTunnel(db, t.id)
    expect(getSsmTunnel(db, t.id)).toBeNull()
  })
  it('unlinks (not deletes) the tunnel when its linked connection is deleted', () => {
    const c = createConnection(db, conn, 1)
    const t = createSsmTunnel(db, { ...input, connectionId: c.id }, 1)
    expect(getSsmTunnel(db, t.id)!.connectionId).toBe(c.id)
    db.prepare('DELETE FROM connections WHERE id = ?').run(c.id)
    expect(getSsmTunnel(db, t.id)!.connectionId).toBeNull() // ON DELETE SET NULL
  })
})
