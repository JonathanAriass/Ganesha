// Shared types for the Telescope inspector — the contract between main (which reads the
// Laravel Telescope tables + parses entry `content` JSON) and the renderer (which displays it).
//
// Ported from the standalone telescope2 viewer's lib/types.ts. Two deliberate differences:
//  - `sequence` is a STRING everywhere: telescope_entries.sequence is BIGINT UNSIGNED and can
//    exceed 2^53, so it is carried as an exact string end-to-end (row id AND pagination cursor).
//  - Every `content` field is optional/nullable — Laravel's per-type JSON varies by version and
//    can be partial; parsers must tolerate missing fields and fall back to a raw view.

/** The 17 Laravel Telescope entry types. Unknown/future types render via the 'generic' summary. */
export type TelescopeType =
  | 'request' | 'exception' | 'query' | 'log' | 'job' | 'mail'
  | 'notification' | 'cache' | 'dump' | 'schedule' | 'command'
  | 'gate' | 'model' | 'event' | 'view' | 'redis' | 'batch'

export const TELESCOPE_TYPES: TelescopeType[] = [
  'request', 'exception', 'query', 'log', 'job', 'mail',
  'notification', 'cache', 'dump', 'schedule', 'command',
  'gate', 'model', 'event', 'view', 'redis', 'batch'
]

// ── Lightweight per-type summaries (list rows) ─────────────────────────────────────────────
export type EntrySummary =
  | { type: 'request'; method: string; uri: string; status: number; duration: number }
  | { type: 'query'; sql: string; duration: number; connection: string }
  | { type: 'exception'; class: string; message: string }
  | { type: 'log'; level: string; message: string }
  | { type: 'job'; name: string; status: string }
  | { type: 'mail'; subject: string; to: string }
  | { type: 'notification'; notification: string; channel: string }
  | { type: 'cache'; key: string; cacheType: string }
  | { type: 'dump'; preview: string }
  | { type: 'schedule'; command: string; expression: string }
  | { type: 'command'; command: string; exitCode: number }
  | { type: 'gate'; ability: string; result: string }
  | { type: 'model'; model: string; action: string }
  | { type: 'event'; name: string; listenerCount: number }
  | { type: 'view'; name: string; path: string }
  | { type: 'redis'; command: string; duration: string } // redis time is a formatted STRING
  | { type: 'batch'; name: string; progress: number; totalJobs: number }
  | { type: 'generic'; preview: string }

// ── Full per-type content shapes (detail pane). All fields optional. ────────────────────────
export interface RequestContent {
  uri?: string | null
  method?: string | null
  controllerAction?: string | null
  middleware?: string[] | null
  headers?: Record<string, string> | null
  payload?: Record<string, unknown> | null
  responseStatus?: number | null
  response?: string | null // response BODY, often itself a JSON string
  duration?: number | null // ms
  memory?: number | null // MB
  hostname?: string | null
}
export interface QueryContent {
  connection?: string | null
  sql?: string | null
  bindings?: unknown[] | null
  time?: number | null // ms
  slow?: boolean | null
  file?: string | null
  line?: number | null
  hash?: string | null
}
export interface ExceptionContent {
  class?: string | null
  file?: string | null
  line?: number | null
  message?: string | null
  context?: Record<string, unknown> | null
  trace?: { file?: string; line?: number; function?: string }[] | null
  linePreview?: Record<string, string> | null
}
export interface LogContent {
  level?: string | null
  message?: string | null
  context?: Record<string, unknown> | null
}
export interface JobContent {
  status?: string | null
  name?: string | null
  queue?: string | null
  connection?: string | null
  tries?: number | null
  timeout?: number | null
  data?: Record<string, unknown> | null
}
export interface MailContent {
  mailable?: string | null
  queued?: boolean | null
  from?: { name?: string; address?: string }[] | null
  replyTo?: { name?: string; address?: string }[] | null
  to?: { name?: string; address?: string }[] | null
  cc?: { name?: string; address?: string }[] | null
  bcc?: { name?: string; address?: string }[] | null
  subject?: string | null
  html?: string | null
}
export interface NotificationContent {
  notification?: string | null
  queued?: boolean | null
  notifiable?: string | null
  channel?: string | null
  response?: unknown
  hostname?: string | null
}
export interface CacheContent {
  cacheType?: string | null // Laravel JSON key is `type` (hit/missed/set/forget)
  key?: string | null
  value?: unknown
  expiration?: number | null
  hostname?: string | null
}
export interface DumpContent {
  dump?: string | null // HTML — shown as escaped source, never rendered
  hostname?: string | null
}
export interface ScheduleContent {
  command?: string | null
  description?: string | null
  expression?: string | null
  timezone?: string | null
  user?: string | null
  output?: string | null
  hostname?: string | null
}
export interface CommandContent {
  command?: string | null
  exitCode?: number | null // Laravel JSON key is `exit_code`
  arguments?: Record<string, unknown> | null
  options?: Record<string, unknown> | null
  hostname?: string | null
}
export interface GateContent {
  ability?: string | null
  result?: string | null // allowed / denied
  arguments?: unknown[] | null
  file?: string | null
  line?: number | null
  hostname?: string | null
}
export interface ModelContent {
  action?: string | null // created / updated / deleted
  model?: string | null
  changes?: Record<string, unknown> | null
  count?: number | null
  hostname?: string | null
}
export interface EventContent {
  name?: string | null
  payload?: Record<string, unknown> | null
  listeners?: unknown[] | null
  broadcast?: boolean | null
  hostname?: string | null
}
export interface ViewContent {
  name?: string | null
  path?: string | null
  data?: unknown[] | null
  composers?: { name?: string; type?: string }[] | null
  hostname?: string | null
}
export interface RedisContent {
  connection?: string | null
  command?: string | null
  time?: string | null // Telescope stores this as a formatted STRING
  hostname?: string | null
}
export interface BatchContent {
  id?: string | null
  name?: string | null
  totalJobs?: number | null
  pendingJobs?: number | null
  processedJobs?: number | null
  progress?: number | null
  failedJobs?: number | null
  options?: Record<string, unknown> | null
  createdAt?: string | null
  cancelledAt?: string | null
  finishedAt?: string | null
  queue?: string | null
  connection?: string | null
  allowsFailures?: boolean | null
  hostname?: string | null
}

/** Typed detail content, discriminated by `type`, with a `raw` fallback for unknown types or
 *  content that fails to match its expected shape (mirrors telescope2's serde Raw fallback). */
export type EntryDetailContent =
  | ({ type: 'request' } & RequestContent)
  | ({ type: 'query' } & QueryContent)
  | ({ type: 'exception' } & ExceptionContent)
  | ({ type: 'log' } & LogContent)
  | ({ type: 'job' } & JobContent)
  | ({ type: 'mail' } & MailContent)
  | ({ type: 'notification' } & NotificationContent)
  | ({ type: 'cache' } & CacheContent)
  | ({ type: 'dump' } & DumpContent)
  | ({ type: 'schedule' } & ScheduleContent)
  | ({ type: 'command' } & CommandContent)
  | ({ type: 'gate' } & GateContent)
  | ({ type: 'model' } & ModelContent)
  | ({ type: 'event' } & EventContent)
  | ({ type: 'view' } & ViewContent)
  | ({ type: 'redis' } & RedisContent)
  | ({ type: 'batch' } & BatchContent)
  | { type: 'raw'; data: Record<string, unknown> }

/** A list-view entry (metadata + lightweight summary). `sequence` is a string (BIGINT-safe). */
export interface TelescopeEntry {
  sequence: string
  uuid: string
  batchId: string
  familyHash: string | null
  type: TelescopeType | string
  createdAt: string | null // raw DB string, e.g. 'YYYY-MM-DD HH:MM:SS'
  summary: EntrySummary
}

/** A detail-view entry (metadata + fully-typed content). */
export interface TelescopeEntryDetail {
  sequence: string
  uuid: string
  batchId: string
  familyHash: string | null
  type: TelescopeType | string
  createdAt: string | null
  content: EntryDetailContent
}

/** One page of entries under keyset pagination on `sequence` DESC. */
export interface TelescopePage {
  entries: TelescopeEntry[]
  nextCursor: string | null // the last entry's sequence, or null when no more
  hasMore: boolean
}

/** Result of probing a connection for Laravel Telescope tables. */
export interface TelescopeDetectResult {
  installed: boolean // telescope_entries present
  present: string[] // which of the wanted telescope_* tables were found
}

/** Structured, renderer-supplied filters (never raw SQL). */
export interface TelescopeFilter {
  type: string | null // null = all types (also forced null when `search` is set)
  tag?: string | null
  search?: string | null
  beforeSequence?: string | null // keyset cursor: fetch entries with sequence < this
  limit?: number
}

/** main→renderer push payload: entries that arrived since the last poll for a connection. */
export interface TelescopeNewEntriesEvent {
  connectionId: string
  entries: TelescopeEntry[]
}
