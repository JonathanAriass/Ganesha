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

/** The slice of net.Socket the forwarder touches — narrowed so tests can fake it. */
export interface ForwardSocket {
  on(event: string, cb: (arg?: unknown) => void): this | ForwardSocket
  destroy(): void
  pipe(dst: NodeJS.ReadWriteStream): NodeJS.ReadWriteStream
}

/** Pipe one inbound local socket out through the ssh client to the DB.
 *
 *  ssh2's `forwardOut` throws SYNCHRONOUSLY with "Not connected" once the client has
 *  dropped (idle disconnect, network blip). Unguarded, that throw escapes the
 *  net.Server 'connection' handler and crashes the whole main process. Catching it
 *  (and a late callback error, and socket/stream errors) degrades a dead tunnel to a
 *  destroyed socket — the driver sees a connection failure and can reconnect. */
export function pipeThroughForward(
  client: SshClientLike,
  socket: ForwardSocket,
  dbHost: string,
  dbPort: number
): void {
  socket.on('error', () => socket.destroy())
  try {
    client.forwardOut('127.0.0.1', 0, dbHost, dbPort, (err, stream) => {
      if (err || !stream) {
        socket.destroy()
        return
      }
      stream.on('error', () => socket.destroy())
      socket.pipe(stream).pipe(socket as unknown as NodeJS.ReadWriteStream)
    })
  } catch {
    socket.destroy()
  }
}

interface LiveTunnel { clients: SshClientLike[]; server: net.Server; endpoint: TunnelEndpoint }

function connectConfig(hop: ResolvedHop, sock?: NodeJS.ReadWriteStream): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    host: hop.host,
    port: hop.port,
    username: hop.username,
    // Detect a silently-dropped connection (and keep NAT/firewall state warm) instead
    // of discovering it only when a query tries to forward through a dead client.
    keepaliveInterval: 15000,
    keepaliveCountMax: 3
  }
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
  // The in-flight/opened tunnel PROMISE is stored synchronously so concurrent
  // open() calls for the same id share one chain instead of each dialing their
  // own (which would leak ssh clients + a bound local port).
  private tunnels = new Map<string, Promise<LiveTunnel>>()
  private make: () => SshClientLike

  constructor(deps?: { createClient?: () => SshClientLike }) {
    this.make = deps?.createClient ?? (() => new Ssh2Client() as unknown as SshClientLike)
  }

  async open(connId: string, hops: ResolvedHop[], dbHost: string, dbPort: number): Promise<TunnelEndpoint> {
    let pending = this.tunnels.get(connId)
    if (!pending) {
      pending = this.dialChain(hops, dbHost, dbPort)
      this.tunnels.set(connId, pending)
      // A failed open must not stay cached as a permanent rejection — let a retry re-dial.
      pending.catch(() => { if (this.tunnels.get(connId) === pending) this.tunnels.delete(connId) })
      // A live tunnel whose ssh connection later drops must not stay cached either, or
      // the next open() hands back a dead endpoint and the forwarder throws on it.
      const owned = pending
      pending.then((t) => this.watchForDrop(connId, owned, t)).catch(() => {})
    }
    return (await pending).endpoint
  }

  /** Tear the tunnel down and evict it the moment any hop's ssh connection drops, so
   *  the next open() dials a fresh chain instead of forwarding onto a closed client. */
  private watchForDrop(connId: string, owned: Promise<LiveTunnel>, t: LiveTunnel): void {
    let torn = false
    const teardown = (): void => {
      if (torn) return
      torn = true
      if (this.tunnels.get(connId) === owned) this.tunnels.delete(connId)
      t.server.close()
      t.clients.forEach((c) => c.end())
    }
    t.clients.forEach((c) => {
      c.on('close', teardown)
      c.on('error', teardown)
    })
  }

  private async dialChain(hops: ResolvedHop[], dbHost: string, dbPort: number): Promise<LiveTunnel> {
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
    const server = net.createServer((socket) => pipeThroughForward(last, socket, dbHost, dbPort))
    // A persistent 'error' listener for the server's whole life: an unhandled 'error'
    // event on a net.Server is itself a process-crashing throw. During bind it rejects
    // the listen promise; afterward it is benign (the dropped-client watcher tears down).
    let onBindError: ((e: Error) => void) | null = null
    server.on('error', (e) => onBindError?.(e))
    try {
      const endpoint = await new Promise<TunnelEndpoint>((resolve, reject) => {
        onBindError = reject
        server.listen(0, '127.0.0.1', () => {
          onBindError = null
          const addr = server.address()
          if (addr && typeof addr === 'object') resolve({ host: '127.0.0.1', port: addr.port })
          else reject(new Error('SSH tunnel: failed to bind local forwarder'))
        })
      })
      return { clients, server, endpoint }
    } catch (e) {
      server.close()
      clients.forEach((c) => c.end())
      throw e
    }
  }

  async close(connId: string): Promise<void> {
    const pending = this.tunnels.get(connId)
    if (!pending) return
    this.tunnels.delete(connId)
    let t: LiveTunnel
    try {
      t = await pending // a close racing an in-flight open waits for it, then tears down
    } catch {
      return // open failed and already cleaned up after itself
    }
    await new Promise<void>((resolve) => t.server.close(() => resolve()))
    t.clients.reverse().forEach((c) => c.end())
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)))
  }
}
