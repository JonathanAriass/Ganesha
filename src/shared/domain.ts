import type { ImportSource } from './transfer'
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
  /** Optional display-only label such as "PROD"; '' = none. Max 12 chars (see shared/environment). */
  environment: string
}

/** A stored connection (input + identity + timestamps), password excluded. */
export interface ConnectionConfig extends ConnectionInput {
  id: string
  /** Group this connection belongs to; null = ungrouped. Set via connections.setGroup, not the edit modal. */
  groupId: string | null
  /** The tool this connection was imported from; null = created here. Set once, on import. */
  importedFrom: ImportSource | null
  createdAt: number
  updatedAt: number
}

/** A named folder for connections (dashboard drag-and-drop target). */
export interface ConnectionGroup {
  id: string
  name: string
  /** Parent group; null = root. Max depth 2 — a subgroup can't have children. */
  parentId: string | null
  /** Display order on the dashboard; new groups append. */
  position: number
  createdAt: number
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
  /** The EC2 `Name` tag when it could be read, else the host name, else the id. */
  name: string
  ping: string
  /** The machine's host name, only when it differs from `name` (searchable too). */
  host?: string
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
  /** Which side of a split the tab was on. Absent in legacy rows → `'left'`. */
  pane: 'left' | 'right'
  /** The focused tab in its pane. At most one per pane; readers tolerate zero/extras. */
  active: boolean
}

/** Every built-in theme id. 'light' is kept (not 'daylight') for backward-compat with
 *  settings saved before the multi-theme picker existed. */
export type ThemeId =
  | 'midnight'
  | 'light'
  | 'dracula'
  | 'nord'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'gruvbox'
  | 'rose-pine'
  | 'catppuccin-latte'
  | 'solarized-light'

export interface ThemeMeta {
  id: ThemeId
  label: string
  mode: 'dark' | 'light'
  /** App background — the main process paints this as the window's launch color (no flash). */
  bg: string
  /** Accent — used for the small swatch in the picker. */
  accent: string
}

/** The theme registry: single source of truth for the picker, the ⌘K palette, and the
 *  launch-background color in main. The actual CSS variables live in styles.css
 *  (one `:root[data-theme='<id>']` block each) and the editor colors in lib/monaco.ts. */
export const THEMES: ThemeMeta[] = [
  { id: 'midnight', label: 'Midnight', mode: 'dark', bg: '#0f1117', accent: '#6366f1' },
  { id: 'light', label: 'Daylight', mode: 'light', bg: '#f7f8fa', accent: '#4f46e5' },
  { id: 'dracula', label: 'Dracula', mode: 'dark', bg: '#282a36', accent: '#bd93f9' },
  { id: 'nord', label: 'Nord', mode: 'dark', bg: '#2e3440', accent: '#88c0d0' },
  { id: 'tokyo-night', label: 'Tokyo Night', mode: 'dark', bg: '#1a1b26', accent: '#7aa2f7' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', mode: 'dark', bg: '#1e1e2e', accent: '#cba6f7' },
  { id: 'gruvbox', label: 'Gruvbox Dark', mode: 'dark', bg: '#282828', accent: '#fe8019' },
  { id: 'rose-pine', label: 'Rosé Pine', mode: 'dark', bg: '#191724', accent: '#c4a7e7' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', mode: 'light', bg: '#eff1f5', accent: '#8839ef' },
  { id: 'solarized-light', label: 'Solarized Light', mode: 'light', bg: '#fdf6e3', accent: '#268bd2' }
]

/** UI density: spacing/type scale of the shell (CSS tokens) plus editor font and grid row height. */
export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = (typeof DENSITIES)[number]

export interface AppSettings {
  theme: ThemeId
  density: Density
  /** Rows the query written for you asks for when you open a table or collection. */
  defaultLimit: number
}

export const DEFAULT_SETTINGS: AppSettings = { theme: 'midnight', density: 'comfortable', defaultLimit: 100 }

/** Largest default limit: what the app keeps of one result. */
export const MAX_DEFAULT_LIMIT = 50000

/** A stored or typed default limit as a whole number from 1 to MAX_DEFAULT_LIMIT; anything
 *  else (blank, text, zero, negative) is the default. Larger values are capped. */
export function parseDefaultLimit(value: string | null): number {
  const n = value === null || value.trim() === '' ? NaN : Number(value)
  if (!Number.isInteger(n) || n < 1) return DEFAULT_SETTINGS.defaultLimit
  return Math.min(n, MAX_DEFAULT_LIMIT)
}

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
