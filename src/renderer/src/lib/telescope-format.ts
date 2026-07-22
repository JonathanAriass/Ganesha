// Display formatters + badge color logic for the Telescope inspector (ported from telescope2's
// formatters.ts + StatusBadge.tsx). Pure functions — unit-tested. Relative time is hand-rolled to
// avoid a date-fns dependency.

/** ms → 'Nμs' / 'N.Nms' / 'N.NNs'. Empty for null/undefined. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return ''
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Truncate with an ellipsis. */
export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '...'
}

/** A Telescope 'YYYY-MM-DD HH:MM:SS' timestamp → a coarse "5m ago" relative string.
 *  Laravel stores created_at in the app timezone (UTC by default), so the value is parsed as UTC. */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(dateStr) ? '' : 'Z'))
  const t = d.getTime()
  if (Number.isNaN(t)) return dateStr
  const secs = Math.round((Date.now() - t) / 1000)
  if (secs < 0) return 'just now'
  if (secs < 60) return secs <= 1 ? 'just now' : `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/** The raw timestamp, for a hover title / absolute display. */
export function formatAbsoluteTime(dateStr: string | null | undefined): string {
  return dateStr ?? ''
}

// ── Badge tones (mapped to CSS classes `.tele-badge.tone-<tone>`) ──────────────────────────────
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'

export function statusTone(status: number): Tone {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'warn'
  if (status >= 400) return 'danger'
  return 'muted'
}

export function logLevelTone(level: string): Tone {
  switch (level.toLowerCase()) {
    case 'info':
    case 'notice':
      return 'info'
    case 'warning':
      return 'warn'
    case 'error':
    case 'critical':
    case 'alert':
    case 'emergency':
      return 'danger'
    default:
      return 'muted' // debug + unknown
  }
}

export function jobStatusTone(status: string): Tone {
  switch (status.toLowerCase()) {
    case 'processed':
      return 'ok'
    case 'failed':
      return 'danger'
    case 'pending':
      return 'warn'
    default:
      return 'muted'
  }
}

export function cacheTypeTone(cacheType: string): Tone {
  switch (cacheType.toLowerCase()) {
    case 'hit':
      return 'ok'
    case 'missed':
      return 'danger'
    case 'set':
      return 'info'
    default:
      return 'muted' // forget + unknown
  }
}

export function gateResultTone(result: string): Tone {
  return result.toLowerCase() === 'allowed' ? 'ok' : 'danger'
}

export function exitCodeTone(code: number): Tone {
  return code === 0 ? 'ok' : 'danger'
}
