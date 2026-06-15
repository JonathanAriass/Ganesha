import type { ConnectionConfig } from '../shared/domain'
import type { DatabaseDriver } from './drivers/types'
import { buildConnectParams } from './drivers/params'
import { resolveHop } from './ssh/auth'
import type { SshTunnelManager } from './ssh/tunnel-manager'

export interface ConnectDeps {
  tunnels: SshTunnelManager
  readFile: (p: string) => Buffer
  /** Passphrase/password for a hop, by hop id (typed override or stored secret). */
  getHopSecret: (hopId: string) => string | null
  dbPassword: string | null
}

/** Connect a driver, transparently routing through an SSH tunnel when the
 *  connection has one enabled. The driver always sees a plain host/port. */
export async function connectVia(driver: DatabaseDriver, config: ConnectionConfig, deps: ConnectDeps): Promise<void> {
  if (config.ssh?.enabled && config.ssh.hops.length > 0) {
    const resolved = config.ssh.hops.map((h) => resolveHop(h, deps.getHopSecret(h.id), deps.readFile))
    const endpoint = await deps.tunnels.open(config.id, resolved, config.host, config.port)
    await driver.connect(buildConnectParams(config, deps.dbPassword, endpoint))
  } else {
    await driver.connect(buildConnectParams(config, deps.dbPassword))
  }
}

export async function disconnectVia(driver: DatabaseDriver, config: ConnectionConfig, tunnels: SshTunnelManager): Promise<void> {
  await driver.disconnect(config.id)
  await tunnels.close(config.id)
}
