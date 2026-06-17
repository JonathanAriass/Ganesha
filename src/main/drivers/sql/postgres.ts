import pg from 'pg'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta,
  DbObject, ObjectRef, ColumnInfo, EditableResult, TableEdits
} from '../types'
import { buildEditableResult, type PerColumnSource } from './edit-target'
import { buildUpdate } from './update-builder'

const { Pool } = pg

interface PgTableMeta { schema: string; name: string; cols: Map<number, string>; pk: string[] }

/** PostgreSQL driver backed by a per-connection pg.Pool. */
export class PostgresDriver implements DatabaseDriver {
  readonly type = 'postgres' as const
  private pools = new Map<string, pg.Pool>()
  private running = new Map<string, number>() // queryId -> backend pid
  private tableMeta = new Map<string, Promise<PgTableMeta | null>>() // `${id}:${oid}` -> table metadata

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
        documents: null,
        editable: await this.deriveEditable(id, fields)
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

  async applyEdits(id: string, edits: TableEdits, opts: { readOnly: boolean }): Promise<{ updated: number }> {
    if (opts.readOnly) throw new Error('Connection is read-only: edits are blocked')
    const client = await this.requirePool(id).connect()
    try {
      await client.query('BEGIN')
      let updated = 0
      for (const row of edits.rows) {
        const { sql, params } = buildUpdate('postgres', edits.table, row)
        const res = await client.query({ text: sql, values: params })
        if (res.rowCount !== 1) {
          throw new Error(`Edit affected ${res.rowCount} rows (expected exactly one) — the row may have changed; refresh and retry`)
        }
        updated += res.rowCount
      }
      await client.query('COMMIT')
      return { updated }
    } catch (e) {
      try { await client.query('ROLLBACK') } catch { /* already aborted */ }
      throw e
    } finally {
      client.release()
    }
  }

  /** Derive the editable descriptor from the result's column metadata: a single source
   *  table (oid) whose attnum→name + primary key are resolved (and cached) on first use. */
  private async deriveEditable(id: string, fields: pg.FieldDef[]): Promise<EditableResult | null> {
    try {
      const oids = [...new Set(fields.map((f) => f.tableID).filter((t) => t && t > 0))]
      if (oids.length !== 1) return null
      const meta = await this.resolvePgTable(id, oids[0])
      if (!meta) return null
      const perColumn: PerColumnSource[] = fields.map((f) =>
        f.tableID === oids[0] && meta.cols.has(f.columnID)
          ? { table: { schema: meta.schema, name: meta.name }, column: meta.cols.get(f.columnID)! }
          : { table: null, column: null }
      )
      return buildEditableResult(perColumn, meta.pk)
    } catch {
      return null
    }
  }

  private resolvePgTable(id: string, oid: number): Promise<PgTableMeta | null> {
    const key = `${id}:${oid}`
    let p = this.tableMeta.get(key)
    if (!p) {
      p = (async (): Promise<PgTableMeta | null> => {
        const pool = this.requirePool(id)
        const meta = await pool.query(
          `SELECT c.relname AS name, n.nspname AS schema FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1`, [oid])
        if (meta.rowCount === 0) return null
        const attrs = await pool.query(
          `SELECT attnum, attname FROM pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped`, [oid])
        const cols = new Map<number, string>(
          (attrs.rows as { attnum: number; attname: string }[]).map((r) => [r.attnum, r.attname]))
        const pkRes = await pool.query(
          `SELECT a.attname FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = $1 AND i.indisprimary ORDER BY a.attnum`, [oid])
        return {
          name: meta.rows[0].name as string,
          schema: meta.rows[0].schema as string,
          cols,
          pk: (pkRes.rows as { attname: string }[]).map((r) => r.attname)
        }
      })()
      this.tableMeta.set(key, p)
      // A transient failure must not be cached as a permanent "not editable".
      p.catch(() => this.tableMeta.delete(key))
    }
    return p
  }

  private requirePool(id: string): pg.Pool {
    const pool = this.pools.get(id)
    if (!pool) throw new Error(`Connection '${id}' is not open`)
    return pool
  }

  async listDatabases(id: string): Promise<string[]> {
    // Postgres connections are scoped to one database; its schemas are the
    // queryable namespaces (`schema.table`), so those are what we suggest.
    const res = await this.requirePool(id).query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
         AND schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast%'
       ORDER BY schema_name`
    )
    return (res.rows as { schema_name: string }[]).map((r) => r.schema_name)
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
