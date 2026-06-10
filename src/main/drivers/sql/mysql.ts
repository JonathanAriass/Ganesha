import mysql from 'mysql2/promise'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta
} from '../types'
import type { ConnectionType } from '../../../shared/domain'

/** MySQL/MariaDB driver (shared wire protocol) backed by a per-connection mysql2 pool.
 *  One class serves both — `type` is set per instance so the registry can hold both. */
export class MySqlDriver implements DatabaseDriver {
  readonly type: ConnectionType
  private pools = new Map<string, mysql.Pool>()
  private running = new Map<string, number>() // queryId -> mysql threadId

  constructor(type: 'mysql' | 'mariadb' = 'mysql') {
    this.type = type
  }

  private poolConfig(p: ConnectParams): mysql.PoolOptions {
    return {
      host: p.host,
      port: p.port,
      user: p.username,
      password: p.password ?? undefined,
      database: p.database || undefined,
      ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 4,
      connectTimeout: 10_000
    }
  }

  async testConnection(p: ConnectParams): Promise<void> {
    const pool = mysql.createPool(this.poolConfig(p))
    try {
      await pool.query('SELECT 1')
    } finally {
      await pool.end()
    }
  }

  async connect(p: ConnectParams): Promise<void> {
    // Idempotent (mirrors PostgresDriver): existing pool keeps its credentials until disconnect().
    if (!this.pools.has(p.id)) this.pools.set(p.id, mysql.createPool(this.poolConfig(p)))
  }

  async disconnect(id: string): Promise<void> {
    const pool = this.pools.get(id)
    if (pool) {
      this.pools.delete(id)
      await pool.end()
    }
  }

  async runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult> {
    if (request.kind !== 'sql') throw new Error('MySqlDriver handles only SQL requests')
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)

    const conn = await pool.getConnection()
    this.running.set(opts.queryId, conn.threadId)
    const start = Date.now()
    try {
      if (opts.readOnly) await conn.query('START TRANSACTION READ ONLY')
      const [rawRows, rawFields] = (await conn.query({ sql: request.sql, rowsAsArray: true })) as [
        unknown,
        mysql.FieldPacket[] | undefined
      ]
      if (opts.readOnly) await conn.query('COMMIT')

      const fields = rawFields ?? []
      const columns: ColumnMeta[] = fields.map((f) => ({
        name: f.name,
        dataType: f.type != null ? String(f.type) : null
      }))
      const isResultSet = Array.isArray(rawRows)
      const allRows = isResultSet ? (rawRows as unknown[][]) : []
      const truncated = allRows.length > opts.maxRows
      const rows = truncated ? allRows.slice(0, opts.maxRows) : allRows
      return {
        columns,
        rows,
        rowCount: isResultSet ? allRows.length : ((rawRows as { affectedRows?: number }).affectedRows ?? 0),
        durationMs: Date.now() - start,
        truncated,
        documents: null
      }
    } catch (e) {
      if (opts.readOnly) {
        try {
          await conn.query('ROLLBACK')
        } catch {
          /* already aborted */
        }
      }
      throw e
    } finally {
      this.running.delete(opts.queryId)
      conn.release()
    }
  }

  async cancel(id: string, queryId: string): Promise<void> {
    const threadId = this.running.get(queryId)
    const pool = this.pools.get(id)
    if (threadId && pool) await pool.query('KILL QUERY ?', [threadId])
  }
}
