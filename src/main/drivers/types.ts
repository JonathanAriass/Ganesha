import type { ConnectionType } from '../../shared/domain'
import type { MongoCommand } from './mongo/command'
import type { ColumnMeta, QueryResult, EditableResult, RowEdit } from '../../shared/query'
import type { DbObject, ObjectRef, ColumnInfo } from '../../shared/schema'
export type { ColumnMeta, QueryResult, EditableResult, RowEdit }
export type { DbObject, ObjectRef, ColumnInfo }

/** A batch of row edits against one table, sent from the renderer to a driver. */
export interface TableEdits {
  table: { schema: string | null; name: string }
  rows: RowEdit[]
}

/** Everything a driver needs to open a connection. Password is resolved by main from the secret store. */
export interface ConnectParams {
  id: string
  type: ConnectionType
  host: string
  port: number
  username: string
  password: string | null
  database: string
  ssl: boolean
  /** Mongo only: authentication database ('' / absent = driver default). */
  authSource?: string
  /** Mongo only: replica set name ('' / absent = direct connection). */
  replicaSet?: string
}

export interface RunOptions {
  /** Hard cap on returned rows; the driver applies it and sets `truncated`. */
  maxRows: number
  /** Caller-supplied id so an in-flight query can be cancelled. */
  queryId: string
  /** When true, the driver ALSO enforces read-only at the server (defense-in-depth). */
  readOnly: boolean
}

/** A query to run: SQL text for relational drivers, a structured command for Mongo. */
export type QueryRequest =
  | { kind: 'sql'; sql: string }
  | { kind: 'mongo'; command: MongoCommand }

/** The contract every concrete driver (Plan 3b) implements. */
export interface DatabaseDriver {
  readonly type: ConnectionType
  /** Open a throwaway connection, verify it works, close it. Throws on failure. */
  testConnection(params: ConnectParams): Promise<void>
  /** Open and pool a connection keyed by params.id. Idempotent. */
  connect(params: ConnectParams): Promise<void>
  /** Close the pooled connection for this id (no-op if absent). */
  disconnect(id: string): Promise<void>
  /** Execute a request against the pooled connection, returning a normalized result. */
  runQuery(id: string, request: QueryRequest, opts: RunOptions): Promise<QueryResult>
  /** Best-effort cancellation of an in-flight query by its RunOptions.queryId. */
  cancel(id: string, queryId: string): Promise<void>
  /** Apply staged cell edits to one table in a single transaction. Each row's UPDATE
   *  must affect exactly one row or the whole batch rolls back. Refuses when readOnly. */
  applyEdits(id: string, edits: TableEdits, opts: { readOnly: boolean }): Promise<{ updated: number }>
  /** List the databases (MySQL) / schemas (Postgres) / databases (Mongo) the
   *  connection can see — names only, for autocomplete. System ones are excluded. */
  listDatabases(id: string): Promise<string[]>
  /** List user tables/views/collections visible on this connection. */
  listObjects(id: string): Promise<DbObject[]>
  /** Describe an object's columns/fields. */
  describeObject(id: string, ref: ObjectRef): Promise<ColumnInfo[]>
}
