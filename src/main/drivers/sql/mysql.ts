import mysql from 'mysql2/promise'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta,
  DbObject, ObjectRef, ColumnInfo
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
      // mysql2 allows connecting with no default database; '' means "none selected".
      database: p.database || undefined,
      ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
      // Exactness first: by default mysql2 decodes BIGINT into a JS number even
      // past 2^53, silently corrupting large ids (…993 reads as …992). With
      // supportBigNumbers — and deliberately WITHOUT bigNumberStrings — values
      // stay native numbers while safe and arrive as exact strings only beyond
      // that, so ordinary ids keep numeric sort/display. The rare giant then
      // sorts as a string in the grid — pg's int8 (always a string) has had
      // that from day one. DECIMAL is exact strings by default; node-postgres
      // gives int8/numeric the same way.
      supportBigNumbers: true,
      connectionLimit: 4,
      connectTimeout: 10_000,
      idleTimeout: 30_000
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
    // conn.threadId is the server connection id cancel() targets with KILL QUERY;
    // only track a valid (>0) id so cancel can never aim at the wrong connection.
    if (conn.threadId > 0) this.running.set(opts.queryId, conn.threadId)
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
        // Number() is defensive: mysql2 returns affectedRows as a string whenever
        // it exceeds MAX_SAFE_INTEGER (unconditionally — independent of
        // supportBigNumbers, which doesn't touch OkPacket parsing).
        rowCount: isResultSet ? allRows.length : Number((rawRows as { affectedRows?: number | string }).affectedRows ?? 0),
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

  private requirePool(id: string): mysql.Pool {
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)
    return pool
  }

  async listDatabases(id: string): Promise<string[]> {
    const [rows] = await this.requirePool(id).query(
      `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
       ORDER BY SCHEMA_NAME`
    )
    return (rows as { name: string }[]).map((r) => r.name)
  }

  async listObjects(id: string): Promise<DbObject[]> {
    const [rows] = await this.requirePool(id).query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS tableType
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
    )
    return (rows as { name: string; tableType: string }[]).map((r) => ({
      schema: null, name: r.name, kind: r.tableType === 'VIEW' ? ('view' as const) : ('table' as const)
    }))
  }

  async describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]> {
    const [rows] = await this.requirePool(id).query(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, (IS_NULLABLE = 'YES') AS nullable
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [ref.name]
    )
    return (rows as { name: string; dataType: string; nullable: number }[]).map((r) => ({
      name: r.name, dataType: r.dataType, nullable: !!r.nullable
    }))
  }
}
