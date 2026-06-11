import { MongoClient } from 'mongodb'
import type { Document, Filter, Sort, UpdateFilter } from 'mongodb'
import type { DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, DbObject, ObjectRef, ColumnInfo } from '../types'
import type { MongoCommand } from './command'
import { isMongoCommandWrite } from './command'
import { normalizeFind, normalizeScalar, normalizeValues, normalizeWriteResult } from './normalize'
import { inferFieldTypes } from './infer'

/** Cap a user-supplied find limit at maxRows+1 — the +1 lets normalizeFind detect
 *  truncation. Mongo treats limit 0 as "no limit", so 0/undefined fall to the cap. */
export function boundedFindLimit(userLimit: number | undefined, maxRows: number): number {
  return userLimit ? Math.min(userLimit, maxRows + 1) : maxRows + 1
}

/** Bound an aggregate's fetch with a terminal $limit, like find — except $out/$merge
 *  pipelines: those stages must stay terminal, and they emit no row output anyway. */
export function boundedPipeline(cmd: MongoCommand, maxRows: number): Record<string, unknown>[] {
  const pipeline = cmd.pipeline ?? []
  return isMongoCommandWrite(cmd) ? pipeline : [...pipeline, { $limit: maxRows + 1 }]
}

/** Build a mongodb:// connection string. Exported for unit tests. */
export function buildMongoUri(p: ConnectParams): string {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : ''
  const opts = new URLSearchParams()
  if (p.ssl) opts.set('tls', 'true')
  if (p.authSource) opts.set('authSource', p.authSource)
  if (p.replicaSet) opts.set('replicaSet', p.replicaSet)
  const qs = opts.toString()
  // The connection-string grammar requires the `/` before `?options` even without a db.
  const path = p.database ? `/${encodeURIComponent(p.database)}` : qs ? '/' : ''
  return `mongodb://${auth}${p.host}:${p.port}${path}${qs ? `?${qs}` : ''}`
}

/** Mongo's bare "Authentication failed." usually means the user is defined in a
 *  different database — when no Auth source is set, auth runs against the URI's
 *  database, so surface the remedy instead of the riddle. */
export function withAuthSourceHint(e: unknown, p: ConnectParams): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/authentication failed/i.test(msg) && !p.authSource && p.database) {
    return new Error(
      `${msg} Without an Auth source, authentication runs against '${p.database}' — ` +
      `if the user is defined elsewhere, set Auth source (commonly 'admin').`
    )
  }
  return e instanceof Error ? e : new Error(msg)
}

interface OpenConnection {
  client: MongoClient
  /** The connection's configured database ('' = none → browse all databases). */
  database: string
}

/** MongoDB driver. Read-only is enforced upstream by the command guard (no SQL-style RO txn). */
export class MongoDriver implements DatabaseDriver {
  readonly type = 'mongodb' as const
  private conns = new Map<string, OpenConnection>()

  private newClient(p: ConnectParams): MongoClient {
    return new MongoClient(buildMongoUri(p), { serverSelectionTimeoutMS: 10_000 })
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const client = this.newClient(p)
    try {
      await client.connect()
      await client.db().command({ ping: 1 })
    } catch (e) {
      throw withAuthSourceHint(e, p)
    } finally {
      await client.close()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    if (this.conns.has(p.id)) return
    const client = this.newClient(p)
    try {
      await client.connect()
    } catch (e) {
      await client.close().catch(() => {})
      throw withAuthSourceHint(e, p)
    }
    this.conns.set(p.id, { client, database: p.database })
  }

  async disconnect(id: string): Promise<void> {
    const conn = this.conns.get(id)
    if (conn) {
      this.conns.delete(id)
      await conn.client.close()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'mongo') throw new Error('MongoDriver handles only Mongo requests')
    const { client } = this.require(id)
    const cmd = request.command
    // cmd.database (shell: db.getSiblingDB) overrides the connection default.
    const coll = client.db(cmd.database).collection(cmd.collection)
    const start = Date.now()
    const ms = (): number => Date.now() - start

    switch (cmd.op) {
      case 'find': {
        const cursor = coll.find(cmd.filter as Filter<Document> ?? {}, {
          projection: cmd.projection,
          sort: cmd.sort as Sort | undefined,
          skip: cmd.skip,
          // A user limit above maxRows would fetch it all before normalize caps the
          // display — bound the cursor itself.
          limit: boundedFindLimit(cmd.limit, opts.maxRows),
          maxTimeMS: 30_000
        })
        return normalizeFind(await cursor.toArray(), opts.maxRows, ms())
      }
      case 'findOne': {
        const doc = await coll.findOne(cmd.filter as Filter<Document> ?? {}, { projection: cmd.projection })
        return normalizeFind(doc ? [doc] : [], opts.maxRows, ms())
      }
      case 'aggregate':
        return normalizeFind(await coll.aggregate(boundedPipeline(cmd, opts.maxRows), { maxTimeMS: 30_000 }).toArray(), opts.maxRows, ms())
      case 'count':
      case 'countDocuments':
        return normalizeScalar('count', await coll.countDocuments(cmd.filter as Filter<Document> ?? {}), ms())
      case 'distinct':
        return normalizeValues('value', await coll.distinct(cmd.field ?? '_id', cmd.filter as Filter<Document> ?? {}), opts.maxRows, ms())
      case 'insertOne':
        return normalizeWriteResult(await coll.insertOne(cmd.document as Document ?? {}), ms())
      case 'insertMany':
        return normalizeWriteResult(await coll.insertMany((cmd.documents ?? []) as Document[]), ms())
      case 'updateOne':
        return normalizeWriteResult(await coll.updateOne(cmd.filter as Filter<Document> ?? {}, cmd.update as UpdateFilter<Document> ?? {}), ms())
      case 'updateMany':
        return normalizeWriteResult(await coll.updateMany(cmd.filter as Filter<Document> ?? {}, cmd.update as UpdateFilter<Document> ?? {}), ms())
      case 'replaceOne':
        return normalizeWriteResult(await coll.replaceOne(cmd.filter as Filter<Document> ?? {}, cmd.replacement as Document ?? {}), ms())
      case 'deleteOne':
        return normalizeWriteResult(await coll.deleteOne(cmd.filter as Filter<Document> ?? {}), ms())
      case 'deleteMany':
        return normalizeWriteResult(await coll.deleteMany(cmd.filter as Filter<Document> ?? {}), ms())
    }
  }

  async cancel(_id: string, _queryId: string): Promise<void> {
    // v1: MongoDB has no simple per-query cancel; ops carry maxTimeMS. killOp is a future enhancement.
  }

  private require(id: string): OpenConnection {
    const conn = this.conns.get(id)
    if (!conn) throw new Error(`Connection '${id}' is not open`)
    return conn
  }

  async listObjects(id: string): Promise<DbObject[]> {
    const { client, database } = this.require(id)
    if (database) {
      const cols = await client.db().listCollections({}, { nameOnly: true }).toArray()
      return cols
        .map((c) => ({ schema: null, name: c.name, kind: 'collection' as const }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    // No database configured — browse every database (the driver would otherwise
    // silently default to 'test'). Databases group in the tree like SQL schemas.
    let names: string[]
    try {
      const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true })
      names = databases.map((d) => d.name)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`Could not list databases (${msg}). Set a Database on the connection to browse one directly.`)
    }
    const out: DbObject[] = []
    for (const name of names) {
      const cols = await client.db(name).listCollections({}, { nameOnly: true }).toArray()
      for (const c of cols) out.push({ schema: name, name: c.name, kind: 'collection' as const })
    }
    return out.sort((a, b) =>
      a.schema === b.schema ? a.name.localeCompare(b.name) : (a.schema ?? '').localeCompare(b.schema ?? '')
    )
  }

  async describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]> {
    const { client } = this.require(id)
    const sample = await client.db(ref.schema ?? undefined).collection(ref.name).findOne({})
    return inferFieldTypes(sample as Record<string, unknown> | null)
  }
}
