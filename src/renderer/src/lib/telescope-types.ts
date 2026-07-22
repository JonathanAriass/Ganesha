// Registry driving the Telescope inspector's type sidebar (label + glyph) and each type's detail
// sub-tabs. Ported from telescope2's telescope-types.ts (lucide icons swapped for emoji glyphs,
// since Ganesha has no lucide dependency).

import type { TelescopeType } from '@shared/telescope'

export interface TypeConfig {
  type: TelescopeType
  label: string
  /** A short glyph shown in the sidebar + entry rows. */
  icon: string
  /** A distinct color per entry type (a dot on the Related tab, so types read at a glance). */
  color: string
}

export const TYPE_CONFIGS: TypeConfig[] = [
  { type: 'request', label: 'Requests', icon: '🌐', color: '#3b82f6' },
  { type: 'exception', label: 'Exceptions', icon: '⚠️', color: '#ef4444' },
  { type: 'query', label: 'Queries', icon: '🗃️', color: '#06b6d4' },
  { type: 'log', label: 'Logs', icon: '📋', color: '#8b5cf6' },
  { type: 'job', label: 'Jobs', icon: '⚙️', color: '#f59e0b' },
  { type: 'mail', label: 'Mail', icon: '✉️', color: '#ec4899' },
  { type: 'notification', label: 'Notifications', icon: '🔔', color: '#0ea5e9' },
  { type: 'cache', label: 'Cache', icon: '💾', color: '#22c55e' },
  { type: 'dump', label: 'Dumps', icon: '🔻', color: '#94a3b8' },
  { type: 'schedule', label: 'Schedule', icon: '⏰', color: '#6366f1' },
  { type: 'command', label: 'Commands', icon: '⌘', color: '#fb923c' },
  { type: 'gate', label: 'Gates', icon: '🔑', color: '#f43f5e' },
  { type: 'model', label: 'Models', icon: '📦', color: '#10b981' },
  { type: 'event', label: 'Events', icon: '📡', color: '#a855f7' },
  { type: 'view', label: 'Views', icon: '👁️', color: '#84cc16' },
  { type: 'redis', label: 'Redis', icon: '🔺', color: '#f97316' },
  { type: 'batch', label: 'Batches', icon: '🎛️', color: '#14b8a6' }
]

const CONFIG_BY_TYPE = new Map(TYPE_CONFIGS.map((c) => [c.type, c]))

/** Config for a type, with a safe fallback for unknown/future types. */
export function typeConfig(type: string): TypeConfig {
  return CONFIG_BY_TYPE.get(type as TelescopeType) ?? { type: type as TelescopeType, label: type, icon: '•', color: 'var(--text-2)' }
}

/** Detail sub-tabs per entry type (drives the detail-pane tab strip). The first tab is default;
 *  a 'Related' tab is appended by the detail component when the entry has a batch. */
export const ENTRY_TYPE_TABS: Record<string, string[]> = {
  request: ['Headers', 'Payload', 'Response'],
  exception: ['Stack Trace', 'Context'],
  query: ['SQL', 'Bindings'],
  log: ['Message', 'Context'],
  job: ['Details', 'Payload'],
  mail: ['Details', 'Preview'],
  cache: ['Details', 'Value'],
  model: ['Details', 'Changes'],
  event: ['Details', 'Listeners'],
  command: ['Details', 'Arguments'],
  schedule: ['Details', 'Output'],
  notification: ['Details'],
  gate: ['Details'],
  view: ['Details'],
  redis: ['Details'],
  batch: ['Details'],
  dump: ['Dump']
}

/** The detail tabs for a type (default single 'Details' tab for unknown types). */
export function detailTabs(type: string): string[] {
  return ENTRY_TYPE_TABS[type] ?? ['Details']
}
