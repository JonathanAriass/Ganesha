import pg from 'pg'
import type {
  DatabaseDriver, ConnectParams, RunOptions, QueryRequest, QueryResult, ColumnMeta,
  DbObject, ObjectRef, ColumnInfo, EditableResult, TableEdits, Relationship,
  TableInfo, ColumnDetail, ConstraintInfo
} from '../types'
import { buildEditableResult, isSingleTableScan, type PerColumnSource } from './edit-target'
import { buildUpdate } from './update-builder'
import { groupIndexes, groupForeignKeys } from './table-info-shape'

/** pg returns bigint counts/sizes as strings; a negative reltuples means "never analyzed". */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const { Pool } = pg

// node-postgres returns these temporal types as JS Date / PostgresInterval objects by default;
// we keep the DB's native text instead (see poolConfig) so they display and round-trip as
// editable strings. OIDs: date, time, timestamp, timestamptz, timetz, interval.
const DATE_TIME_OIDS = new Set([1082, 1083, 1114, 1184, 1266, 1186])

interface PgTableMeta { schema: string; name: string; cols: Map<number, string>; pk: string[] }

/** PostgreSQL driver backed by a per-connection pg.Pool. */
export class PostgresDriver implements DatabaseDriver {
  readonly type = 'postgres' as const
  private pools = new Map<string, pg.Pool>()
  private running = new Map<string, number>() // queryId -> backend pid
  private tableMeta = new Map<string, Promise<PgTableMeta | null>>() // `${id}:${oid}` -> table metadata

  private poolConfig(p: ConnectParams): pg.PoolConfig {
    // Numbers keep the node-postgres defaults: int8 and numeric come back as exact strings
    // (never a lossy JS number) — the same contract MySqlDriver gets from supportBigNumbers.
    // Dates are the exception: the defaults return JS Date objects, which the renderer can only
    // show as quoted ISO ("…Z") — un-editable (the DB rejects the quotes when bound back) and
    // timezone-ambiguous. Return the DB's native text for date/time types so they display
    // cleanly and round-trip exactly when edited.
    return {
      host: p.host,
      port: p.port,
      user: p.username,
      password: p.password ?? undefined,
      database: p.database,
      ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      types: {
        getTypeParser: (oid, format) =>
          DATE_TIME_OIDS.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format)
      }
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
        editable: await this.deriveEditable(id, fields, request.sql)
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
  private async deriveEditable(id: string, fields: pg.FieldDef[], sql: string): Promise<EditableResult | null> {
    try {
      const oids = [...new Set(fields.map((f) => f.tableID).filter((t) => t && t > 0))]
      if (oids.length !== 1) return null
      const meta = await this.resolvePgTable(id, oids[0])
      if (!meta) return null
      // A self-join (incl. via CTE / derived table) shows one source table in the
      // metadata but spans two base rows per result row — refuse it (the row key would
      // target the wrong row).
      if (!isSingleTableScan(sql, meta.name)) return null
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

  async listRelationships(id: string): Promise<Relationship[]> {
    // pg_constraint + unnest WITH ORDINALITY pairs each FK column with its referenced column in order
    // (information_schema's constraint_column_usage mis-pairs composite keys — a known gotcha).
    const res = await this.requirePool(id).query(
      `SELECT ns.nspname AS "fromSchema", cl.relname AS "fromTable", att.attname AS "fromColumn",
              fns.nspname AS "toSchema", fcl.relname AS "toTable", fatt.attname AS "toColumn"
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       JOIN pg_class fcl ON fcl.oid = c.confrelid
       JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
       JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(conkey, confkey, ord) ON true
       JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.conkey
       JOIN pg_attribute fatt ON fatt.attrelid = c.confrelid AND fatt.attnum = k.confkey
       WHERE c.contype = 'f' AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`
    )
    return (res.rows as Omit<Relationship, 'origin'>[]).map((r) => ({ ...r, origin: 'declared' as const }))
  }

  async describeTableInfo(id: string, ref: ObjectRef): Promise<TableInfo> {
    const pool = this.requirePool(id)
    const args = [ref.schema ?? 'public', ref.name]

    const columns = (
      await pool.query(
        `SELECT c.column_name AS name, c.data_type AS "dataType", (c.is_nullable = 'YES') AS nullable,
                c.column_default AS "default", COALESCE(pk.is_pk, false) AS "primaryKey"
         FROM information_schema.columns c
         LEFT JOIN (
           SELECT kcu.column_name, true AS is_pk
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
         ) pk ON pk.column_name = c.column_name
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        args
      )
    ).rows as ColumnDetail[]

    // Index columns paired by position via unnest WITH ORDINALITY (expression indexes — attnum 0 —
    // have no pg_attribute row and drop their expression columns; acceptable for v1).
    const indexes = groupIndexes(
      (
        await pool.query(
          `SELECT i.relname AS name, a.attname AS column, ix.indisunique AS unique,
                  ix.indisprimary AS primary, am.amname AS method, k.ord::int AS ord
           FROM pg_class t
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_index ix ON ix.indrelid = t.oid
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_am am ON am.oid = i.relam
           JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE n.nspname = $1 AND t.relname = $2
           ORDER BY i.relname, k.ord`,
          args
        )
      ).rows
    )

    // Outgoing FKs: this table's columns → the referenced table's columns.
    const foreignKeys = groupForeignKeys(
      (
        await pool.query(
          `SELECT c.conname AS name, att.attname AS column,
                  fns.nspname AS "refSchema", fcl.relname AS "refTable", fatt.attname AS "refColumn", k.ord::int AS ord
           FROM pg_constraint c
           JOIN pg_class cl ON cl.oid = c.conrelid
           JOIN pg_namespace ns ON ns.oid = cl.relnamespace
           JOIN pg_class fcl ON fcl.oid = c.confrelid
           JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
           JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(conkey, confkey, ord) ON true
           JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.conkey
           JOIN pg_attribute fatt ON fatt.attrelid = c.confrelid AND fatt.attnum = k.confkey
           WHERE c.contype = 'f' AND ns.nspname = $1 AND cl.relname = $2
           ORDER BY c.conname, k.ord`,
          args
        )
      ).rows
    )

    // Incoming refs: other tables' FKs that point at us. `refTable` = the referencing table,
    // `refColumns` = its FK columns, `columns` = our referenced columns (reads "refTable.refColumns → columns").
    const referencedBy = groupForeignKeys(
      (
        await pool.query(
          `SELECT c.conname AS name, fatt.attname AS column,
                  ns.nspname AS "refSchema", cl.relname AS "refTable", att.attname AS "refColumn", k.ord::int AS ord
           FROM pg_constraint c
           JOIN pg_class cl ON cl.oid = c.conrelid
           JOIN pg_namespace ns ON ns.oid = cl.relnamespace
           JOIN pg_class fcl ON fcl.oid = c.confrelid
           JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
           JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(conkey, confkey, ord) ON true
           JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.conkey
           JOIN pg_attribute fatt ON fatt.attrelid = c.confrelid AND fatt.attnum = k.confkey
           WHERE c.contype = 'f' AND fns.nspname = $1 AND fcl.relname = $2
           ORDER BY c.conname, k.ord`,
          args
        )
      ).rows
    )

    const constraints = (
      await pool.query(
        `SELECT con.conname AS name,
                CASE con.contype WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check' END AS type,
                pg_get_constraintdef(con.oid) AS detail
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = cl.relnamespace
         WHERE con.contype IN ('u', 'c') AND ns.nspname = $1 AND cl.relname = $2
         ORDER BY con.conname`,
        args
      )
    ).rows as ConstraintInfo[]

    const sizeRow = (
      await pool.query(
        `SELECT pg_total_relation_size(c.oid) AS bytes, c.reltuples::bigint AS "rowEstimate"
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        args
      )
    ).rows[0] as { bytes: unknown; rowEstimate: unknown } | undefined
    const est = sizeRow ? numOrNull(sizeRow.rowEstimate) : null
    const size = sizeRow
      ? { bytes: numOrNull(sizeRow.bytes), rowEstimate: est !== null && est >= 0 ? est : null }
      : null

    return { ref, columns, indexes, foreignKeys, referencedBy, constraints, size }
  }
}
