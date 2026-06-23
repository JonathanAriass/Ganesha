export type ConnectionType = 'postgres' | 'mysql' | 'mariadb' | 'mongodb'

/** One SSH hop in a tunnel chain. hops[0] is the first server reached from this
 *  machine; the DB host/port is the final forward target, reached from the last hop. */
export interface SshHop {
  /** Stable id; secrets are keyed by it so reordering hops never scrambles them. */
  id: string
  host: string
  port: number
  username: string
  auth: 'key' | 'password'
  /** Path to the private key file when auth === 'key'; '' otherwise. */
  keyPath: string
}

/** SSH tunnel config for a connection. enabled=false keeps the typed hops but skips the tunnel. */
export interface SshConfig {
  enabled: boolean
  hops: SshHop[]
}

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
  /** When true, results-grid cell edits stage until an explicit commit instead of
   *  writing immediately ("prevent fast commit"). Ignored on read-only connections. */
  requireCommit: boolean
  /** Mongo only: authentication database; '' = driver default (the connection db / admin). */
  authSource: string
  /** Mongo only: replica set name; '' = direct connection. */
  replicaSet: string
  /** SSH tunnel; null = never configured. */
  ssh: SshConfig | null
  /** Absolute path to a local code repo the assistant reads for context; null = not linked. */
  repoPath: string | null
}

/** A stored connection (input + identity + timestamps), password excluded. */
export interface ConnectionConfig extends ConnectionInput {
  id: string
  createdAt: number
  updatedAt: number
}

/** Fields the user supplies for an AWS SSM port-forwarding tunnel. */
export interface SsmTunnelInput {
  name: string
  /** AWS CLI profile (e.g. an SSO profile). */
  profile: string
  region: string
  /** EC2 instance id the session targets. */
  instanceId: string
  /** Port on the remote host (e.g. 3306 for MySQL). */
  remotePort: number
  /** Local port the tunnel listens on (e.g. 13306). */
  localPort: number
  /** DB connection this tunnel serves; null = unlinked. Drives the connect-time "tunnel down" offer. */
  connectionId: string | null
}

export interface SsmTunnel extends SsmTunnelInput {
  id: string
  createdAt: number
  updatedAt: number
}

/** An SSM-managed EC2 instance, for the tunnel form's instance picker. */
export interface AwsInstance {
  instanceId: string
  name: string
  ping: string
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

/** One persisted query tab, mirrored from the renderer's tab strip on every
 *  change (debounced). Text only — results, errors, and run state never touch
 *  disk, and a restored tab never auto-runs. Array order is display order. */
export interface SessionTab {
  id: string
  connectionId: string
  title: string
  text: string
  /** The focused tab. At most one should be flagged; readers tolerate zero
   *  (fall back to the last tab) and extras (the first flagged one wins). */
  active: boolean
}

export interface AppSettings {
  theme: 'midnight' | 'light'
}

export const DEFAULT_SETTINGS: AppSettings = { theme: 'midnight' }

// ── Local LLM assistant ──

/** A GGUF model file downloaded into the app's models dir. id = filename. */
export interface LocalModel {
  id: string
  name: string
  path: string
  sizeBytes: number
}

/** A curated, downloadable model (Hugging Face URI node-llama-cpp understands). */
export interface CatalogModel {
  id: string
  name: string
  uri: string
  sizeLabel: string
  description: string
}

/** A chat thread, scoped to one connection. */
export interface LlmConversation {
  id: string
  connectionId: string
  title: string
  createdAt: number
  updatedAt: number
}

/** One message in a conversation. */
export interface LlmMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}
