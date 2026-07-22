// Pure presenters turning a TelescopeEntry's summary into the strings/badge the UI shows — shared
// by the list row, the "Related" rows, and the detail header so they never drift apart.
import type { TelescopeEntry } from '@shared/telescope'
import {
  formatDuration, formatRelativeTime, statusTone, logLevelTone, jobStatusTone, cacheTypeTone,
  gateResultTone, exitCodeTone, type Tone
} from './telescope-format'
import { typeConfig } from './telescope-types'

/** Glyph for an entry's type. */
export function entryIcon(e: TelescopeEntry): string {
  return typeConfig(e.type).icon
}

/** For requests, the HTTP method shown as a mono prefix; null otherwise. */
export function entryMethod(e: TelescopeEntry): string | null {
  return e.summary.type === 'request' ? e.summary.method || null : null
}

/** The primary (first-line) text. */
export function entryPrimary(e: TelescopeEntry): string {
  const s = e.summary
  switch (s.type) {
    case 'request': return s.uri || '/'
    case 'query': return s.sql
    case 'exception': return s.class
    case 'log': return s.message
    case 'job': return s.name
    case 'mail': return s.subject || '(no subject)'
    case 'notification': return s.notification
    case 'cache': return s.key
    case 'dump': return s.preview
    case 'schedule': return s.command
    case 'command': return s.command
    case 'gate': return s.ability
    case 'model': return s.model
    case 'event': return s.name
    case 'view': return s.name
    case 'redis': return s.command
    case 'batch': return s.name
    default: return s.preview
  }
}

/** The secondary (second-line) metadata parts, joined by ' · ' in the UI. Always ends with time. */
export function entrySecondary(e: TelescopeEntry): string[] {
  const s = e.summary
  const t = formatRelativeTime(e.createdAt)
  const parts = ((): (string | null | undefined)[] => {
    switch (s.type) {
      case 'request': return [formatDuration(s.duration)]
      case 'query': return [formatDuration(s.duration), s.connection]
      case 'exception': return [s.message]
      case 'log': return [s.level]
      case 'job': return [s.status]
      case 'mail': return [`to: ${s.to}`]
      case 'notification': return [s.channel]
      case 'cache': return [s.cacheType]
      case 'command': return [`exit ${s.exitCode}`]
      case 'gate': return [s.result]
      case 'model': return [s.action]
      case 'event': return [`${s.listenerCount} listener${s.listenerCount === 1 ? '' : 's'}`]
      case 'view': return [s.path]
      case 'redis': return [`${s.duration}ms`]
      case 'batch': return [`${s.progress}% of ${s.totalJobs}`]
      case 'schedule': return [s.expression]
      default: return []
    }
  })()
  return [...parts, t].filter((p): p is string => !!p)
}

/** The colored badge for the row/header (status, level, job/cache/gate/exit), or null. */
export function entryBadge(e: TelescopeEntry): { text: string; tone: Tone } | null {
  const s = e.summary
  switch (s.type) {
    case 'request': return s.status ? { text: String(s.status), tone: statusTone(s.status) } : null
    case 'log': return s.level ? { text: s.level, tone: logLevelTone(s.level) } : null
    case 'job': return s.status ? { text: s.status, tone: jobStatusTone(s.status) } : null
    case 'cache': return s.cacheType ? { text: s.cacheType, tone: cacheTypeTone(s.cacheType) } : null
    case 'gate': return s.result ? { text: s.result, tone: gateResultTone(s.result) } : null
    case 'command': return { text: `exit ${s.exitCode}`, tone: exitCodeTone(s.exitCode) }
    default: return null
  }
}

/** The detail-header title (e.g. 'GET /api/users'). */
export function entryTitle(e: TelescopeEntry): string {
  const m = entryMethod(e)
  return m ? `${m} ${entryPrimary(e)}` : entryPrimary(e)
}
