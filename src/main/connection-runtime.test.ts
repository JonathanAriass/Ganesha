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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDriver(): any {
  return { connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tunnels: any = { open: vi.fn(async () => ({ host: '127.0.0.1', port: 55001 })), close: vi.fn() }
    const deps: ConnectDeps = { tunnels, readFile: () => Buffer.from(''), getHopSecret: () => 'pw', dbPassword: 'dbpw' }
    await connectVia(driver, { ...base, ssh } as ConnectionConfig, deps)
    expect(tunnels.open).toHaveBeenCalledWith('c1', expect.any(Array), 'db.internal', 5432)
    expect(driver.connect.mock.calls[0][0]).toMatchObject({ host: '127.0.0.1', port: 55001, password: 'dbpw' })
  })

  it('skips the tunnel when SSH is configured but disabled', async () => {
    const driver = fakeDriver()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tunnels: any = { open: vi.fn(), close: vi.fn() }
    const deps: ConnectDeps = { tunnels, readFile: () => Buffer.from(''), getHopSecret: () => null, dbPassword: 'pw' }
    await connectVia(driver, { ...base, ssh: { enabled: false, hops: ssh.hops } } as ConnectionConfig, deps)
    expect(tunnels.open).not.toHaveBeenCalled()
    expect(driver.connect.mock.calls[0][0].host).toBe('db.internal')
  })
})

describe('disconnectVia', () => {
  it('disconnects the driver then closes the tunnel', async () => {
    const driver = fakeDriver()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tunnels: any = { close: vi.fn(async () => {}) }
    await disconnectVia(driver, { ...base, ssh } as ConnectionConfig, tunnels)
    expect(driver.disconnect).toHaveBeenCalledWith('c1')
    expect(tunnels.close).toHaveBeenCalledWith('c1')
  })
})
