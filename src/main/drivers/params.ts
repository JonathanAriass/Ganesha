import type { ConnectionConfig } from '../../shared/domain'
import type { ConnectParams } from './types'

/** Build driver ConnectParams from a stored config + its secret. */
export function buildConnectParams(config: ConnectionConfig, password: string | null): ConnectParams {
  return {
    id: config.id, type: config.type, host: config.host, port: config.port,
    username: config.username, password, database: config.database, ssl: config.ssl,
    authSource: config.authSource, replicaSet: config.replicaSet
  }
}
