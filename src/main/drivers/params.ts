import type { ConnectionConfig } from '../../shared/domain'
import type { ConnectParams } from './types'

/** Build driver ConnectParams from a stored config + its secret. An optional
 *  override replaces host/port with the local SSH tunnel endpoint. */
export function buildConnectParams(
  config: ConnectionConfig,
  password: string | null,
  override?: { host: string; port: number }
): ConnectParams {
  return {
    id: config.id, type: config.type,
    host: override?.host ?? config.host,
    port: override?.port ?? config.port,
    username: config.username, password, database: config.database, ssl: config.ssl,
    authSource: config.authSource, replicaSet: config.replicaSet
  }
}
