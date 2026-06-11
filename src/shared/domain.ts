export type ConnectionType = 'postgres' | 'mysql' | 'mariadb' | 'mongodb'

/** Fields the user supplies when creating/editing a connection (no password here). */
export interface ConnectionInput {
  type: ConnectionType
  name: string
  color: string
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  readOnly: boolean
  /** Mongo only: authentication database; '' = driver default (the connection db / admin). */
  authSource: string
  /** Mongo only: replica set name; '' = direct connection. */
  replicaSet: string
}

/** A stored connection (input + identity + timestamps), password excluded. */
export interface ConnectionConfig extends ConnectionInput {
  id: string
  createdAt: number
  updatedAt: number
}

export interface HistoryEntryInput {
  connectionId: string
  query: string
  ranAt: number
  durationMs: number | null
  success: boolean | null
}

export interface HistoryEntry extends HistoryEntryInput {
  id: number
}

/** Fields the user supplies when saving a query under a name. */
export interface SavedQueryInput {
  connectionId: string
  name: string
  query: string
}

/** The editable fields — a saved query never moves between connections. */
export type SavedQueryPatch = Partial<Pick<SavedQueryInput, 'name' | 'query'>>

export interface SavedQuery extends SavedQueryInput {
  id: string
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  theme: 'midnight' | 'light'
}

export const DEFAULT_SETTINGS: AppSettings = { theme: 'midnight' }
