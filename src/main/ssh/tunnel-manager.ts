import net from 'net'
import { Client as Ssh2Client } from 'ssh2'
import type { ResolvedHop } from './auth'

export interface TunnelEndpoint { host: string; port: number }

/** The slice of ssh2.Client this manager uses — narrowed so tests can fake it. */
export interface SshClientLike {
  on(event: string, cb: (arg?: unknown) => void): this
  connect(cfg: Record<string, unknown>): void
  forwardOut(srcHost: string, srcPort: number, dstHost: string, dstPort: number,
             cb: (err: Error | null, stream?: NodeJS.ReadWriteStream) => void): void
  end(): void
}

interface LiveTunnel { clients: SshClientLike[]; server: net.Server; endpoint: TunnelEndpoint }

function connectConfig(hop: ResolvedHop, sock?: NodeJS.ReadWriteStream): Record<string, unknown> {
  const cfg: Record<string, unknown> = { host: hop.host, port: hop.port, username: hop.username }
  if (sock) cfg.sock = sock
  if (hop.auth === 'key') {
    cfg.privateKey = hop.privateKey
    if (hop.passphrase) cfg.passphrase = hop.passphrase
  } else {
    cfg.password = hop.password
  }
  return cfg
}

/** Dial one ssh2 client and resolve when authenticated (or reject with a hop-tagged error). */
function dial(make: () => SshClientLike, hop: ResolvedHop, index: number, sock?: NodeJS.ReadWriteStream): Promise<SshClientLike> {
  return new Promise((resolve, reject) => {
    const client = make()
    client.on('ready', () => resolve(client))
    client.on('error', () => reject(new Error(`SSH tunnel: authentication failed at hop ${index + 1} (${hop.host})`)))
    client.connect(connectConfig(hop, sock))
  })
}

/** forwardOut as a promise. */
function forward(client: SshClientLike, dstHost: string, dstPort: number): Promise<NodeJS.ReadWriteStream> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
      if (err || !stream) reject(new Error(`SSH tunnel: hop unreachable: ${dstHost}:${dstPort}`))
      else resolve(stream)
    })
  })
}

export class SshTunnelManager {
  private tunnels = new Map<string, LiveTunnel>()
  private make: () => SshClientLike

  constructor(deps?: { createClient?: () => SshClientLike }) {
    this.make = deps?.createClient ?? (() => new Ssh2Client() as unknown as SshClientLike)
  }

  async open(connId: string, hops: ResolvedHop[], dbHost: string, dbPort: number): Promise<TunnelEndpoint> {
    const existing = this.tunnels.get(connId)
    if (existing) return existing.endpoint
    if (hops.length === 0) throw new Error('SSH tunnel: no hops configured')

    const clients: SshClientLike[] = []
    try {
      // Dial hop 0 directly; each subsequent hop through the previous client's forwardOut.
      clients.push(await dial(this.make, hops[0], 0))
      for (let i = 1; i < hops.length; i++) {
        const stream = await forward(clients[i - 1], hops[i].host, hops[i].port)
        clients.push(await dial(this.make, hops[i], i, stream))
      }
    } catch (e) {
      clients.forEach((c) => c.end())
      throw e
    }

    const last = clients[clients.length - 1]
    const server = net.createServer((socket) => {
      last.forwardOut('127.0.0.1', 0, dbHost, dbPort, (err, stream) => {
        if (err || !stream) { socket.destroy(); return }
        socket.pipe(stream).pipe(socket)
      })
    })
    const endpoint = await new Promise<TunnelEndpoint>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') resolve({ host: '127.0.0.1', port: addr.port })
        else reject(new Error('SSH tunnel: failed to bind local forwarder'))
      })
    })

    this.tunnels.set(connId, { clients, server, endpoint })
    return endpoint
  }

  async close(connId: string): Promise<void> {
    const t = this.tunnels.get(connId)
    if (!t) return
    this.tunnels.delete(connId)
    await new Promise<void>((resolve) => t.server.close(() => resolve()))
    t.clients.reverse().forEach((c) => c.end())
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)))
  }
}
