import { MongoClient } from 'mongodb'
import type { Document, Filter, Sort, UpdateFilter } from 'mongodb'
import type { DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult } from '../types'
import { normalizeFind, normalizeScalar, normalizeValues, normalizeWriteResult } from './normalize'

/** MongoDB driver. Read-only is enforced upstream by the command guard (no SQL-style RO txn). */
export class MongoDriver implements DatabaseDriver {
  readonly type = 'mongodb' as const
  private clients = new Map<string, MongoClient>()

  private uri(p: ConnectParams): string {
    const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : ''
    const db = p.database ? `/${encodeURIComponent(p.database)}` : ''
    const tls = p.ssl ? '?tls=true' : ''
    return `mongodb://${auth}${p.host}:${p.port}${db}${tls}`
  }

  private newClient(p: ConnectParams): MongoClient {
    return new MongoClient(this.uri(p), { serverSelectionTimeoutMS: 10_000 })
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const client = this.newClient(p)
    try {
      await client.connect()
      await client.db().command({ ping: 1 })
    } finally {
      await client.close()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    if (this.clients.has(p.id)) return
    const client = this.newClient(p)
    await client.connect()
    this.clients.set(p.id, client)
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (client) {
      this.clients.delete(id)
      await client.close()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'mongo') throw new Error('MongoDriver handles only Mongo requests')
    const client = this.clients.get(id)
    if (!client) throw new Error(`Connection '${id}' is not open`)
    const cmd = request.command
    const coll = client.db().collection(cmd.collection)
    const start = Date.now()
    const ms = (): number => Date.now() - start

    switch (cmd.op) {
      case 'find': {
        const cursor = coll.find(cmd.filter as Filter<Document> ?? {}, {
          projection: cmd.projection,
          sort: cmd.sort as Sort | undefined,
          skip: cmd.skip,
          limit: cmd.limit ?? opts.maxRows + 1,
          maxTimeMS: 30_000
        })
        return normalizeFind(await cursor.toArray(), opts.maxRows, ms())
      }
      case 'findOne': {
        const doc = await coll.findOne(cmd.filter as Filter<Document> ?? {}, { projection: cmd.projection })
        return normalizeFind(doc ? [doc] : [], opts.maxRows, ms())
      }
      case 'aggregate':
        return normalizeFind(await coll.aggregate(cmd.pipeline ?? [], { maxTimeMS: 30_000 }).toArray(), opts.maxRows, ms())
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

  async cancel(): Promise<void> {
    // v1: MongoDB has no simple per-query cancel; ops carry maxTimeMS. killOp is a future enhancement.
  }
}
