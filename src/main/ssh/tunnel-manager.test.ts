import { describe, it, expect } from 'vitest'
import { SshTunnelManager, pipeThroughForward, type SshClientLike, type ForwardSocket } from './tunnel-manager'
import type { ResolvedHop } from './auth'

/** A fake ssh2 client recording connects + forwardOut targets. `clients[i].emit`
 *  drives lifecycle events (e.g. 'close') so tests can simulate a dropped tunnel. */
function fakeClientFactory(opts: { failAuthAt?: number } = {}) {
  const events: string[] = []
  const clients: { emit: (ev: string, arg?: unknown) => void }[] = []
  let n = 0
  const make = (): SshClientLike => {
    const idx = n++
    const handlers: Record<string, ((arg?: unknown) => void)[]> = {}
    const client: SshClientLike = {
      on(ev, cb) { (handlers[ev] ??= []).push(cb as () => void); return client },
      connect(cfg: Record<string, unknown>) {
        events.push(`connect#${idx}:${String(cfg.host)}`)
        queueMicrotask(() => {
          if (opts.failAuthAt === idx) handlers['error']?.forEach((h) => h(new Error('auth')))
          else handlers['ready']?.forEach((h) => h())
        })
      },
      forwardOut(_sh, _sp, dh: string, dp: number, cb: (e: Error | null, s?: NodeJS.ReadWriteStream) => void) {
        events.push(`forward#${idx}->${dh}:${dp}`)
        cb(null, { on() {}, write() {}, end() {}, pipe() {} } as unknown as NodeJS.ReadWriteStream)
      },
      end() { events.push(`end#${idx}`) }
    }
    clients.push({ emit: (ev, arg) => handlers[ev]?.forEach((h) => h(arg)) })
    return client
  }
  return { make, events, clients }
}

/** A fake inbound socket recording whether it was destroyed / piped. */
function fakeSocket(): ForwardSocket & { destroyed: boolean; piped: boolean } {
  const s = {
    destroyed: false,
    piped: false,
    on() { return s },
    destroy() { s.destroyed = true },
    pipe() { s.piped = true; return s as unknown as NodeJS.ReadWriteStream }
  }
  return s
}

const hops = (n: number): ResolvedHop[] =>
  Array.from({ length: n }, (_, i) => ({ host: `h${i}`, port: 22, username: 'u', auth: 'password' as const, password: 'p' }))

describe('SshTunnelManager', () => {
  it('dials hops in order, the next hop tunneled through the previous, then forwards to the DB', async () => {
    const f = fakeClientFactory()
    const mgr = new SshTunnelManager({ createClient: f.make })
    const ep = await mgr.open('c1', hops(2), 'db.internal', 5432)
    expect(ep.host).toBe('127.0.0.1')
    expect(ep.port).toBeGreaterThan(0)
    // hop0 connects; hop1 reached via forwardOut on client0; DB forward issued on client1.
    expect(f.events).toEqual(['connect#0:h0', 'forward#0->h1:22', 'connect#1:h1'])
    await mgr.close('c1')
  })

  it('open is idempotent per connection id', async () => {
    const f = fakeClientFactory()
    const mgr = new SshTunnelManager({ createClient: f.make })
    const a = await mgr.open('c1', hops(1), 'db', 5432)
    const b = await mgr.open('c1', hops(1), 'db', 5432)
    expect(a.port).toBe(b.port)
    expect(f.events.filter((e) => e.startsWith('connect')).length).toBe(1)
    await mgr.close('c1')
  })

  it('concurrent opens for the same id share one tunnel (no double-dial, no leaked port)', async () => {
    const f = fakeClientFactory()
    const mgr = new SshTunnelManager({ createClient: f.make })
    const [a, b] = await Promise.all([
      mgr.open('c1', hops(1), 'db', 5432),
      mgr.open('c1', hops(1), 'db', 5432)
    ])
    expect(a.port).toBe(b.port) // same local forwarder
    expect(f.events.filter((e) => e.startsWith('connect')).length).toBe(1) // dialed once
    await mgr.close('c1')
  })

  it('surfaces a hop auth failure with its index', async () => {
    const f = fakeClientFactory({ failAuthAt: 1 })
    const mgr = new SshTunnelManager({ createClient: f.make })
    await expect(mgr.open('c1', hops(2), 'db', 5432)).rejects.toThrow(/SSH tunnel: authentication failed at hop 2 \(h1\)/)
  })

  it('re-dials a fresh tunnel after the ssh connection drops (no stale endpoint reuse)', async () => {
    const f = fakeClientFactory()
    const mgr = new SshTunnelManager({ createClient: f.make })
    await mgr.open('c1', hops(1), 'db', 5432)
    // The ssh client drops (idle disconnect / network blip). The cached endpoint is
    // now dead — the manager must evict it so the next open dials again.
    f.clients[0].emit('close')
    await new Promise((r) => setTimeout(r, 0))
    await mgr.open('c1', hops(1), 'db', 5432)
    expect(f.events.filter((e) => e.startsWith('connect')).length).toBe(2)
    await mgr.close('c1')
  })
})

describe('pipeThroughForward', () => {
  it('destroys the socket (does not throw) when forwardOut throws synchronously', () => {
    // ssh2 throws "Not connected" synchronously once the client has dropped; the
    // forwarder must NOT let that reach the process as an uncaught exception.
    const deadClient = {
      on() { return deadClient },
      connect() {},
      forwardOut() { throw new Error('Not connected') },
      end() {}
    } as unknown as SshClientLike
    const socket = fakeSocket()
    expect(() => pipeThroughForward(deadClient, socket, 'db', 5432)).not.toThrow()
    expect(socket.destroyed).toBe(true)
    expect(socket.piped).toBe(false)
  })

  it('destroys the socket when forwardOut calls back with an error', () => {
    const client = {
      on() { return client },
      connect() {},
      forwardOut(_sh: string, _sp: number, _dh: string, _dp: number, cb: (e: Error | null) => void) {
        cb(new Error('channel open failure'))
      },
      end() {}
    } as unknown as SshClientLike
    const socket = fakeSocket()
    pipeThroughForward(client, socket, 'db', 5432)
    expect(socket.destroyed).toBe(true)
  })

  it('pipes the socket through the stream on success', () => {
    const f = fakeClientFactory()
    const client = f.make()
    const socket = fakeSocket()
    pipeThroughForward(client, socket, 'db', 5432)
    expect(socket.piped).toBe(true)
    expect(socket.destroyed).toBe(false)
  })
})
