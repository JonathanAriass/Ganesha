import pg from 'pg'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta,
  DbObject, ObjectRef, ColumnInfo
} from '../types'

const { Pool } = pg

/** PostgreSQL driver backed by a per-connection pg.Pool. */
export class PostgresDriver implements DatabaseDriver {
  readonly type = 'postgres' as const
  private pools = new Map<string, pg.Pool>()
  private running = new Map<string, number>() // queryId -> backend pid

  private poolConfig(p: ConnectParams): pg.PoolConfig {
    // No custom type parsers on purpose: node-postgres defaults return int8 and
    // numeric as exact strings (never a lossy JS number) — the same contract
    // MySqlDriver gets from supportBigNumbers. Don't "fix" them into numbers.
    return {
      host: p.host,
      port: p.port,
      user: p.username,
      password: p.password ?? undefined,
      database: p.database,
      ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000
    }
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const pool = new Pool(this.poolConfig(p))
    try {
      await pool.query('SELECT 1')
    } finally {
      await pool.end()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    // Idempotent: an existing pool keeps its original credentials. To apply changed
    // credentials, callers must disconnect() first. The query pipeline relies on this.
    if (!this.pools.has(p.id)) this.pools.set(p.id, new Pool(this.poolConfig(p)))
  }

  async disconnect(id: string): Promise<void> {
    const pool = this.pools.get(id)
    if (pool) {
      this.pools.delete(id)
      await pool.end()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'sql') throw new Error('PostgresDriver handles only SQL requests')
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)

    const client = await pool.connect()
    // pg.PoolClient wraps a pg.Client whose `processID` (backend PID, needed for
    // pg_cancel_backend) is populated during the auth handshake before pool.connect()
    // resolves, but isn't typed on PoolClient — hence the cast.
    const pid = (client as unknown as { processID: number }).processID
    this.running.set(opts.queryId, pid)
    const start = Date.now()
    try {
      if (opts.readOnly) await client.query('BEGIN TRANSACTION READ ONLY')
      const res = await client.query({ text: request.sql, rowMode: 'array' })
      if (opts.readOnly) await client.query('COMMIT')

      const fields = res.fields ?? []
      const columns: ColumnMeta[] = fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) }))
      const allRows = (res.rows as unknown as unknown[][]) ?? []
      const truncated = allRows.length > opts.maxRows
      const rows = truncated ? allRows.slice(0, opts.maxRows) : allRows
      return {
        columns,
        rows,
        rowCount: typeof res.rowCount === 'number' ? res.rowCount : rows.length,
        durationMs: Date.now() - start,
        truncated,
        documents: null
      }
    } catch (e) {
      if (opts.readOnly) {
        try {
          await client.query('ROLLBACK')
        } catch {
          /* already aborted */
        }
      }
      throw e
    } finally {
      this.running.delete(opts.queryId)
      client.release()
    }
  }

  async cancel(id: string, queryId: string): Promise<void> {
    const pid = this.running.get(queryId)
    const pool = this.pools.get(id)
    if (pid && pool) await pool.query('SELECT pg_cancel_backend($1)', [pid])
  }

  private requirePool(id: string): pg.Pool {
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)
    return pool
  }

  async listObjects(id: string): Promise<DbObject[]> {
    const res = await this.requirePool(id).query(
      `SELECT table_schema AS schema, table_name AS name,
              CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name`
    )
    return res.rows as DbObject[]
  }

  async describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]> {
    const res = await this.requirePool(id).query(
      `SELECT column_name AS name, data_type AS "dataType", (is_nullable = 'YES') AS nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [ref.schema ?? 'public', ref.name]
    )
    return res.rows as ColumnInfo[]
  }
}
