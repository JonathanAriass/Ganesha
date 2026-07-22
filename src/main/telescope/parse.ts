// Pure TypeScript port of telescope2's Rust content parser (src-tauri/src/telescope/parser.rs).
// Decodes a Telescope entry's already-JSON.parsed `content` two ways:
//   parseEntrySummary — a lightweight, per-type summary for the list row.
//   parseEntryDetail  — the fully-typed content for the detail pane, mapping Laravel's
//                       snake_case JSON keys to our camelCase Content shapes, with a `raw`
//                       fallback for unknown/future entry types.
// Both tolerate missing fields (Telescope's per-type JSON varies by version and can be partial).

import type {
  EntrySummary, EntryDetailContent,
  RequestContent, QueryContent, ExceptionContent, LogContent, JobContent, MailContent,
  NotificationContent, CacheContent, DumpContent, ScheduleContent, CommandContent, GateContent,
  ModelContent, EventContent, ViewContent, RedisContent, BatchContent
} from '../../shared/telescope'

type Json = Record<string, unknown>

// ── helpers (faithful to parser.rs) ─────────────────────────────────────────────────────────
const asObject = (c: unknown): Json => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const intOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : null)
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const uint = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0)

/** A number, or a PHP number_format string like "1,234.56" (strip commas), else 0. */
export function parseTime(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = parseFloat(v.replace(/,/g, '')); return Number.isNaN(n) ? 0 : n }
  return 0
}

/** Truncate to `max` code points with an ellipsis. Counts/splits on code points (not UTF-16 units)
 *  so a multi-byte char (emoji) is never cut into a lone surrogate. */
export function trunc(s: string, max: number): string {
  const cp = [...s]
  return cp.length <= max ? s : cp.slice(0, max).join('') + '...'
}

/** Last segment of a PHP FQCN: 'App\\Notifications\\OrderShipped' → 'OrderShipped'. */
export function shortClass(fqcn: string): string {
  const i = fqcn.lastIndexOf('\\')
  return i < 0 ? fqcn : fqcn.slice(i + 1)
}

/** Naive tag stripper (matches parser.rs strip_html_tags): drop everything between '<' and '>'. */
export function stripHtml(html: string): string {
  let out = ''
  let inTag = false
  for (const ch of html) {
    if (ch === '<') { inTag = true; continue }
    if (ch === '>') { inTag = false; continue }
    if (!inTag) out += ch
  }
  return out
}

const objOrNull = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const arrOrNull = <T = unknown>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null)

// ── summaries (list rows) ────────────────────────────────────────────────────────────────────
export function parseEntrySummary(type: string, content: unknown): EntrySummary {
  const c = asObject(content)
  switch (type) {
    case 'request':
      return { type: 'request', method: str(c.method), uri: str(c.uri), status: uint(c.response_status), duration: parseTime(c.duration) }
    case 'query':
      return { type: 'query', sql: trunc(str(c.sql), 200), duration: parseTime(c.time), connection: str(c.connection) }
    case 'exception':
      return { type: 'exception', class: str(c.class), message: trunc(str(c.message), 200) }
    case 'log':
      return { type: 'log', level: str(c.level), message: trunc(str(c.message), 200) }
    case 'job':
      return { type: 'job', name: str(c.name), status: str(c.status) }
    case 'mail': {
      // Keep a present-but-empty address as '' (like the reference's unwrap_or, which only defaults
      // when the address is absent/non-string) rather than coercing it to 'unknown'.
      const first = arrOrNull<Json>(c.to)?.[0]
      const address = first && typeof first.address === 'string' ? first.address : null
      return { type: 'mail', subject: str(c.subject), to: address ?? 'unknown' }
    }
    case 'notification':
      return { type: 'notification', notification: shortClass(str(c.notification)), channel: str(c.channel) }
    case 'cache':
      return { type: 'cache', key: str(c.key), cacheType: str(c.type) }
    case 'dump':
      return { type: 'dump', preview: trunc(stripHtml(str(c.dump)), 60) }
    case 'schedule':
      return { type: 'schedule', command: str(c.command), expression: str(c.expression) }
    case 'command':
      return { type: 'command', command: str(c.command), exitCode: uint(c.exit_code) }
    case 'gate':
      return { type: 'gate', ability: str(c.ability), result: str(c.result) }
    case 'model':
      return { type: 'model', model: shortClass(str(c.model)), action: str(c.action) }
    case 'event':
      return { type: 'event', name: shortClass(str(c.name)), listenerCount: Array.isArray(c.listeners) ? c.listeners.length : 0 }
    case 'view':
      return { type: 'view', name: str(c.name), path: str(c.path) }
    case 'redis':
      return { type: 'redis', command: trunc(str(c.command), 60), duration: typeof c.time === 'string' ? c.time : '0' }
    case 'batch':
      return { type: 'batch', name: str(c.name), progress: uint(c.progress), totalJobs: uint(c.totalJobs) }
    default:
      return { type: 'generic', preview: trunc(JSON.stringify(content ?? {}), 100) }
  }
}

// ── detail (detail pane) — map snake_case JSON → camelCase Content, else raw ────────────────────
export function parseEntryDetail(type: string, content: unknown): EntryDetailContent {
  // A typed detail shape needs a JSON object; anything else (string/number/array/null) — like an
  // unknown type — degrades to a raw view of the ORIGINAL source (mirrors the reference's serde
  // "deserialize to the typed struct, else Raw{data: original}").
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { type: 'raw', data: content }
  }
  const c = content as Json
  switch (type) {
    case 'request': {
      const v: RequestContent = {
        uri: strOrNull(c.uri), method: strOrNull(c.method), controllerAction: strOrNull(c.controller_action),
        middleware: arrOrNull<string>(c.middleware), headers: objOrNull(c.headers) as Record<string, string> | null,
        payload: objOrNull(c.payload), responseStatus: intOrNull(c.response_status),
        response: strOrNull(c.response), duration: c.duration == null ? null : parseTime(c.duration),
        memory: c.memory == null ? null : parseTime(c.memory), hostname: strOrNull(c.hostname)
      }
      return { type: 'request', ...v }
    }
    case 'query': {
      const v: QueryContent = {
        connection: strOrNull(c.connection), sql: strOrNull(c.sql), bindings: arrOrNull(c.bindings),
        time: c.time == null ? null : parseTime(c.time), slow: boolOrNull(c.slow),
        file: strOrNull(c.file), line: intOrNull(c.line), hash: strOrNull(c.hash)
      }
      return { type: 'query', ...v }
    }
    case 'exception': {
      const v: ExceptionContent = {
        class: strOrNull(c.class), file: strOrNull(c.file), line: intOrNull(c.line), message: strOrNull(c.message),
        context: objOrNull(c.context), trace: arrOrNull(c.trace), linePreview: objOrNull(c.line_preview) as Record<string, string> | null
      }
      return { type: 'exception', ...v }
    }
    case 'log': {
      const v: LogContent = { level: strOrNull(c.level), message: strOrNull(c.message), context: objOrNull(c.context) }
      return { type: 'log', ...v }
    }
    case 'job': {
      const v: JobContent = {
        status: strOrNull(c.status), name: strOrNull(c.name), queue: strOrNull(c.queue), connection: strOrNull(c.connection),
        tries: intOrNull(c.tries), timeout: intOrNull(c.timeout), data: objOrNull(c.data)
      }
      return { type: 'job', ...v }
    }
    case 'mail': {
      const addr = (v: unknown): { name?: string; address?: string }[] | null => arrOrNull(v)
      const v: MailContent = {
        mailable: strOrNull(c.mailable), queued: boolOrNull(c.queued), from: addr(c.from), replyTo: addr(c.reply_to),
        to: addr(c.to), cc: addr(c.cc), bcc: addr(c.bcc), subject: strOrNull(c.subject), html: strOrNull(c.html)
      }
      return { type: 'mail', ...v }
    }
    case 'notification': {
      const v: NotificationContent = {
        notification: strOrNull(c.notification), queued: boolOrNull(c.queued), notifiable: strOrNull(c.notifiable),
        channel: strOrNull(c.channel), response: c.response, hostname: strOrNull(c.hostname)
      }
      return { type: 'notification', ...v }
    }
    case 'cache': {
      const v: CacheContent = {
        cacheType: strOrNull(c.type), key: strOrNull(c.key), value: c.value,
        expiration: intOrNull(c.expiration), hostname: strOrNull(c.hostname)
      }
      return { type: 'cache', ...v }
    }
    case 'dump': {
      const v: DumpContent = { dump: strOrNull(c.dump), hostname: strOrNull(c.hostname) }
      return { type: 'dump', ...v }
    }
    case 'schedule': {
      const v: ScheduleContent = {
        command: strOrNull(c.command), description: strOrNull(c.description), expression: strOrNull(c.expression),
        timezone: strOrNull(c.timezone), user: strOrNull(c.user), output: strOrNull(c.output), hostname: strOrNull(c.hostname)
      }
      return { type: 'schedule', ...v }
    }
    case 'command': {
      const v: CommandContent = {
        command: strOrNull(c.command), exitCode: intOrNull(c.exit_code), arguments: objOrNull(c.arguments),
        options: objOrNull(c.options), hostname: strOrNull(c.hostname)
      }
      return { type: 'command', ...v }
    }
    case 'gate': {
      const v: GateContent = {
        ability: strOrNull(c.ability), result: strOrNull(c.result), arguments: arrOrNull(c.arguments),
        file: strOrNull(c.file), line: intOrNull(c.line), hostname: strOrNull(c.hostname)
      }
      return { type: 'gate', ...v }
    }
    case 'model': {
      const v: ModelContent = {
        action: strOrNull(c.action), model: strOrNull(c.model), changes: objOrNull(c.changes),
        count: intOrNull(c.count), hostname: strOrNull(c.hostname)
      }
      return { type: 'model', ...v }
    }
    case 'event': {
      const v: EventContent = {
        name: strOrNull(c.name), payload: objOrNull(c.payload), listeners: arrOrNull(c.listeners),
        broadcast: boolOrNull(c.broadcast), hostname: strOrNull(c.hostname)
      }
      return { type: 'event', ...v }
    }
    case 'view': {
      const v: ViewContent = {
        name: strOrNull(c.name), path: strOrNull(c.path), data: arrOrNull(c.data),
        composers: arrOrNull(c.composers), hostname: strOrNull(c.hostname)
      }
      return { type: 'view', ...v }
    }
    case 'redis': {
      const v: RedisContent = {
        connection: strOrNull(c.connection), command: strOrNull(c.command),
        time: strOrNull(c.time), hostname: strOrNull(c.hostname)
      }
      return { type: 'redis', ...v }
    }
    case 'batch': {
      const v: BatchContent = {
        id: strOrNull(c.id), name: strOrNull(c.name), totalJobs: intOrNull(c.totalJobs), pendingJobs: intOrNull(c.pendingJobs),
        processedJobs: intOrNull(c.processedJobs), progress: intOrNull(c.progress), failedJobs: intOrNull(c.failedJobs),
        options: objOrNull(c.options), createdAt: strOrNull(c.createdAt), cancelledAt: strOrNull(c.cancelledAt),
        finishedAt: strOrNull(c.finishedAt), queue: strOrNull(c.queue), connection: strOrNull(c.connection),
        allowsFailures: boolOrNull(c.allowsFailures), hostname: strOrNull(c.hostname)
      }
      return { type: 'batch', ...v }
    }
    default:
      return { type: 'raw', data: c }
  }
}
