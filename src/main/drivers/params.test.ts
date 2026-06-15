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
