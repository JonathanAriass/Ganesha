import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { SsmTunnel, SsmTunnelInput } from '../../shared/domain'

interface Row {
  id: string; name: string; profile: string; region: string; instance_id: string
  remote_port: number; local_port: number; connection_id: string | null
  created_at: number; updated_at: number
}

function toTunnel(r: Row): SsmTunnel {
  return {
    id: r.id, name: r.name, profile: r.profile, region: r.region, instanceId: r.instance_id,
    remotePort: r.remote_port, localPort: r.local_port, connectionId: r.connection_id,
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export function listSsmTunnels(db: DB): SsmTunnel[] {
  return (db.prepare('SELECT * FROM ssm_tunnels ORDER BY created_at').all() as Row[]).map(toTunnel)
}

export function getSsmTunnel(db: DB, id: string): SsmTunnel | null {
  const row = db.prepare('SELECT * FROM ssm_tunnels WHERE id = ?').get(id) as Row | undefined
  return row ? toTunnel(row) : null
}

export function createSsmTunnel(db: DB, input: SsmTunnelInput, now: number): SsmTunnel {
  const id = randomUUID()
  db.prepare(`INSERT INTO ssm_tunnels
    (id,name,profile,region,instance_id,remote_port,local_port,connection_id,created_at,updated_at)
    VALUES (@id,@name,@profile,@region,@instanceId,@remotePort,@localPort,@connectionId,@now,@now)`)
    .run({
      id, name: input.name, profile: input.profile, region: input.region, instanceId: input.instanceId,
      remotePort: input.remotePort, localPort: input.localPort, connectionId: input.connectionId ?? null, now
    })
  return getSsmTunnel(db, id) as SsmTunnel
}

export function updateSsmTunnel(db: DB, id: string, patch: Partial<SsmTunnelInput>, now: number): SsmTunnel {
  const current = getSsmTunnel(db, id)
  if (!current) throw new Error(`SSM tunnel not found: ${id}`)
  const next = { ...current, ...patch }
  db.prepare(`UPDATE ssm_tunnels SET name=@name,profile=@profile,region=@region,instance_id=@instanceId,
    remote_port=@remotePort,local_port=@localPort,connection_id=@connectionId,updated_at=@now WHERE id=@id`)
    .run({
      id, name: next.name, profile: next.profile, region: next.region, instanceId: next.instanceId,
      remotePort: next.remotePort, localPort: next.localPort, connectionId: next.connectionId ?? null, now
    })
  return getSsmTunnel(db, id) as SsmTunnel
}

export function deleteSsmTunnel(db: DB, id: string): void {
  db.prepare('DELETE FROM ssm_tunnels WHERE id = ?').run(id)
}
