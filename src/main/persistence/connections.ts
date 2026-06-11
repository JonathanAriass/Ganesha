import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { ConnectionConfig, ConnectionInput } from '../../shared/domain'

interface Row {
  id: string; type: string; name: string; color: string; host: string; port: number
  username: string; db_name: string; ssl: number; read_only: number
  auth_source: string; replica_set: string
  created_at: number; updated_at: number
}

function toConfig(r: Row): ConnectionConfig {
  return {
    id: r.id, type: r.type as ConnectionConfig['type'], name: r.name, color: r.color,
    host: r.host, port: r.port, username: r.username, database: r.db_name,
    ssl: !!r.ssl, readOnly: !!r.read_only,
    authSource: r.auth_source, replicaSet: r.replica_set,
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export function createConnection(db: DB, input: ConnectionInput, now: number): ConnectionConfig {
  const id = randomUUID()
  db.prepare(`INSERT INTO connections
    (id,type,name,color,host,port,username,db_name,ssl,read_only,auth_source,replica_set,created_at,updated_at)
    VALUES (@id,@type,@name,@color,@host,@port,@username,@database,@ssl,@readOnly,@authSource,@replicaSet,@now,@now)`)
    .run({ id, ...input, ssl: input.ssl ? 1 : 0, readOnly: input.readOnly ? 1 : 0, now })
  return getConnection(db, id) as ConnectionConfig
}

export function listConnections(db: DB): ConnectionConfig[] {
  return (db.prepare('SELECT * FROM connections ORDER BY created_at DESC').all() as Row[]).map(toConfig)
}

export function getConnection(db: DB, id: string): ConnectionConfig | null {
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Row | undefined
  return row ? toConfig(row) : null
}

export function updateConnection(db: DB, id: string, patch: Partial<ConnectionInput>, now: number): ConnectionConfig {
  const current = getConnection(db, id)
  if (!current) throw new Error(`Connection not found: ${id}`)
  const next = { ...current, ...patch }
  db.prepare(`UPDATE connections SET
    type=@type,name=@name,color=@color,host=@host,port=@port,username=@username,
    db_name=@database,ssl=@ssl,read_only=@readOnly,
    auth_source=@authSource,replica_set=@replicaSet,updated_at=@now WHERE id=@id`)
    .run({ ...next, id, ssl: next.ssl ? 1 : 0, readOnly: next.readOnly ? 1 : 0, now })
  return getConnection(db, id) as ConnectionConfig
}

export function deleteConnection(db: DB, id: string): void {
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
}
