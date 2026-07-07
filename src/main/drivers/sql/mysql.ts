import mysql from 'mysql2/promise'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta,
  DbObject, ObjectRef, ColumnInfo, EditableResult, TableEdits, Relationship,
  TableInfo, ColumnDetail, ConstraintInfo
} from '../types'
import type { ConnectionType } from '../../../shared/domain'
import { buildEditableResult, isSingleTableScan, type PerColumnSource } from './edit-target'
import { buildUpdate } from './update-builder'
import { groupIndexes, groupForeignKeys } from './table-info-shape'

/** mysql2 may return bigint sizes as strings (supportBigNumbers); coerce, garbage → null. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** MySQL/MariaDB driver (shared wire protocol) backed by a per-connection mysql2 pool.
 *  One class serves both — `type` is set per instance so the registry can hold both. */
export class MySqlDriver implements DatabaseDriver {
  readonly type: ConnectionType
  private pools = new Map<string, mysql.Pool>()
  private running = new Map<string, number>() // queryId -> mysql threadId
  private pkCache = new Map<string, Promise<string[]>>() // `${id}:${db}.${table}` -> PK columns

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
      // Return DATE/DATETIME/TIMESTAMP as the DB's native text, not JS Date objects: the
      // renderer can only edit a string, and a Date would render as quoted ISO that mysql
      // rejects when bound back. Strings round-trip exactly.
      dateStrings: true,
      // mysql2 enables CLIENT_FOUND_ROWS by default, so affectedRows reports MATCHED
      // (not just changed) rows — which applyEdits' "exactly one row" guard relies on to
      // tell a missing/changed-underneath row (0 matched) from a no-op edit (same value).
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
        documents: null,
        editable: await this.deriveEditable(conn, id, fields, request.sql)
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

  async applyEdits(id: string, edits: TableEdits, opts: { readOnly: boolean }): Promise<{ updated: number }> {
    if (opts.readOnly) throw new Error('Connection is read-only: edits are blocked')
    const conn = await this.requirePool(id).getConnection()
    try {
      await conn.beginTransaction()
      let updated = 0
      for (const row of edits.rows) {
        const { sql, params } = buildUpdate('mysql', edits.table, row)
        const [res] = await conn.query(sql, params)
        const affected = (res as { affectedRows?: number }).affectedRows ?? 0
        if (affected !== 1) {
          throw new Error(`Edit affected ${affected} rows (expected exactly one) — the row may have changed; refresh and retry`)
        }
        updated += affected
      }
      await conn.commit()
      return { updated }
    } catch (e) {
      try { await conn.rollback() } catch { /* already rolled back */ }
      throw e
    } finally {
      conn.release()
    }
  }

  /** Derive the editable descriptor from the result fields' orgTable/orgName/db, with
   *  the table's primary key resolved (and cached) on first use. */
  private async deriveEditable(conn: mysql.PoolConnection, id: string, fields: mysql.FieldPacket[], sql: string): Promise<EditableResult | null> {
    try {
      const fds = fields as unknown as Array<{ orgTable?: string; orgName?: string; db?: string }>
      const tables = [...new Set(fds.map((f) => f.orgTable).filter((t): t is string => !!t))]
      if (tables.length !== 1) return null
      // A self-join (incl. via CTE / derived table) shows one source table but spans two
      // base rows per result row — refuse.
      if (!isSingleTableScan(sql, tables[0])) return null
      const db = fds.find((f) => f.orgTable === tables[0])?.db ?? ''
      const pk = await this.pkColumns(conn, id, db, tables[0])
      const perColumn: PerColumnSource[] = fds.map((f) =>
        f.orgTable === tables[0] && f.orgName
          ? { table: { schema: db, name: tables[0] }, column: f.orgName }
          : { table: null, column: null }
      )
      return buildEditableResult(perColumn, pk)
    } catch {
      return null
    }
  }

  private pkColumns(conn: mysql.PoolConnection, id: string, db: string, table: string): Promise<string[]> {
    const key = `${id}:${db}.${table}`
    let p = this.pkCache.get(key)
    if (!p) {
      p = (async () => {
        const [rows] = await conn.query(
          `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
           WHERE CONSTRAINT_NAME = 'PRIMARY' AND TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
          [db, table]
        )
        return (rows as { c: string }[]).map((r) => r.c)
      })()
      this.pkCache.set(key, p)
      p.catch(() => this.pkCache.delete(key)) // don't cache a transient failure
    }
    return p
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

  async listRelationships(id: string): Promise<Relationship[]> {
    const [rows] = await this.requirePool(id).query(
      `SELECT TABLE_NAME AS fromTable, COLUMN_NAME AS fromColumn,
              REFERENCED_TABLE_NAME AS toTable, REFERENCED_COLUMN_NAME AS toColumn
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
    )
    // Single-database scope (schema stays null, matching listObjects); cross-db FKs are out of v1.
    return (rows as { fromTable: string; fromColumn: string; toTable: string; toColumn: string }[]).map((r) => ({
      fromSchema: null, fromTable: r.fromTable, fromColumn: r.fromColumn,
      toSchema: null, toTable: r.toTable, toColumn: r.toColumn, origin: 'declared' as const
    }))
  }

  async describeTableInfo(id: string, ref: ObjectRef): Promise<TableInfo> {
    const pool = this.requirePool(id)
    const a = [ref.name]

    const [colRows] = await pool.query(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS dataType, (IS_NULLABLE='YES') AS nullable,
              COLUMN_DEFAULT AS def, (COLUMN_KEY='PRI') AS pk
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      a
    )
    const columns: ColumnDetail[] = (colRows as Record<string, unknown>[]).map((r) => ({
      name: r.name as string, dataType: r.dataType as string, nullable: !!r.nullable,
      default: (r.def as string | null) ?? null, primaryKey: !!r.pk
    }))

    const [ixRows] = await pool.query(
      `SELECT INDEX_NAME AS name, COLUMN_NAME AS col, (NON_UNIQUE=0) AS uniq,
              (INDEX_NAME='PRIMARY') AS prim, INDEX_TYPE AS method, SEQ_IN_INDEX AS ord
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      a
    )
    const indexes = groupIndexes((ixRows as Record<string, unknown>[]).map((r) => ({
      name: r.name as string, column: r.col as string, unique: !!r.uniq, primary: !!r.prim,
      method: (r.method as string | null) ?? null, ord: Number(r.ord)
    })))

    const [fkRows] = await pool.query(
      `SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS refTable,
              REFERENCED_COLUMN_NAME AS refColumn, ORDINAL_POSITION AS ord
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      a
    )
    const foreignKeys = groupForeignKeys((fkRows as Record<string, unknown>[]).map((r) => ({
      name: r.name as string, column: r.col as string, refSchema: null,
      refTable: r.refTable as string, refColumn: r.refColumn as string, ord: Number(r.ord)
    })))

    // Incoming: refTable = the referencing table, refColumns = its FK columns, columns = our referenced columns.
    const [refByRows] = await pool.query(
      `SELECT CONSTRAINT_NAME AS name, REFERENCED_COLUMN_NAME AS col, TABLE_NAME AS refTable,
              COLUMN_NAME AS refColumn, ORDINAL_POSITION AS ord
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      a
    )
    const referencedBy = groupForeignKeys((refByRows as Record<string, unknown>[]).map((r) => ({
      name: r.name as string, column: r.col as string, refSchema: null,
      refTable: r.refTable as string, refColumn: r.refColumn as string, ord: Number(r.ord)
    })))

    // CHECK constraints — best-effort (information_schema.CHECK_CONSTRAINTS is MySQL 8.0.16+ /
    // recent MariaDB; on older servers the query throws and we return none). Unique constraints
    // are surfaced as unique indexes above.
    let constraints: ConstraintInfo[] = []
    try {
      const [ckRows] = await pool.query(
        `SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS detail
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.CHECK_CONSTRAINTS cc
           ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`,
        a
      )
      constraints = (ckRows as Record<string, unknown>[]).map((r) => ({
        name: r.name as string, type: 'check', detail: String(r.detail ?? '')
      }))
    } catch {
      constraints = []
    }

    const [szRows] = await pool.query(
      `SELECT TABLE_ROWS AS rowEstimate, (DATA_LENGTH + INDEX_LENGTH) AS bytes
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      a
    )
    const sz = (szRows as Record<string, unknown>[])[0]
    const size = sz ? { rowEstimate: numOrNull(sz.rowEstimate), bytes: numOrNull(sz.bytes) } : null

    return { ref, columns, indexes, foreignKeys, referencedBy, constraints, size }
  }
}
