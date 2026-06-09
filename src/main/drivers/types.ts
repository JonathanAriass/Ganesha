import type { ConnectionType } from '../../shared/domain'
import type { MongoCommand } from './mongo/command'

export interface ColumnMeta {
  name: string
  /** Driver-reported type label if available (e.g. 'int4', 'varchar', 'ObjectId'). */
  dataType: string | null
}

/** Normalized, IPC-serializable result set returned by every driver. */
export interface QueryResult {
  columns: ColumnMeta[]
  /** Row-major: each inner array aligns positionally to `columns`. */
  rows: unknown[][]
  rowCount: number
  durationMs: number
  /** True when the driver capped the row set (see RunOptions.maxRows). */
  truncated: boolean
  /** For document stores (Mongo) / JSON columns: raw objects for a tree view; null otherwise. */
  documents: Record<string, unknown>[] | null
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
}
