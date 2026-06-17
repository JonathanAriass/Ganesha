import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { ConnectionConfig, ConnectionInput } from '../../shared/domain'

interface Row {
  id: string; type: string; name: string; color: string; host: string; port: number
  username: string; db_name: string; ssl: number; read_only: number; require_commit: number
  auth_source: string; replica_set: string; ssh_json: string | null
  created_at: number; updated_at: number
}

function toConfig(r: Row): ConnectionConfig {
  return {
    id: r.id, type: r.type as ConnectionConfig['type'], name: r.name, color: r.color,
    host: r.host, port: r.port, username: r.username, database: r.db_name,
    ssl: !!r.ssl, readOnly: !!r.read_only, requireCommit: !!r.require_commit,
    authSource: r.auth_source, replicaSet: r.replica_set,
    ssh: r.ssh_json ? (JSON.parse(r.ssh_json) as ConnectionConfig['ssh']) : null,
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export function createConnection(db: DB, input: ConnectionInput, now: number): ConnectionConfig {
  const id = randomUUID()
  // ssh is an object/null — store it as JSON, not as a bind param of its own.
  const { ssh, ...flat } = input
  db.prepare(`INSERT INTO connections
    (id,type,name,color,host,port,username,db_name,ssl,read_only,require_commit,auth_source,replica_set,ssh_json,created_at,updated_at)
    VALUES (@id,@type,@name,@color,@host,@port,@username,@database,@ssl,@readOnly,@requireCommit,@authSource,@replicaSet,@ssh_json,@now,@now)`)
    .run({ id, ...flat, ssl: input.ssl ? 1 : 0, readOnly: input.readOnly ? 1 : 0, requireCommit: input.requireCommit ? 1 : 0, ssh_json: ssh ? JSON.stringify(ssh) : null, now })
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
    db_name=@database,ssl=@ssl,read_only=@readOnly,require_commit=@requireCommit,
    auth_source=@authSource,replica_set=@replicaSet,ssh_json=@ssh_json,updated_at=@now WHERE id=@id`)
    .run({ ...next, id, ssl: next.ssl ? 1 : 0, readOnly: next.readOnly ? 1 : 0, requireCommit: next.requireCommit ? 1 : 0, ssh_json: next.ssh ? JSON.stringify(next.ssh) : null, now })
  return getConnection(db, id) as ConnectionConfig
}

export function deleteConnection(db: DB, id: string): void {
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
}
