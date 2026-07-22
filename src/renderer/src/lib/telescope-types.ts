// Registry driving the Telescope inspector's type sidebar (label + glyph) and each type's detail
// sub-tabs. Ported from telescope2's telescope-types.ts (lucide icons swapped for emoji glyphs,
// since Ganesha has no lucide dependency).

import type { TelescopeType } from '@shared/telescope'

export interface TypeConfig {
  type: TelescopeType
  label: string
  /** A short glyph shown in the sidebar + entry rows. */
  icon: string
}

export const TYPE_CONFIGS: TypeConfig[] = [
  { type: 'request', label: 'Requests', icon: '🌐' },
  { type: 'exception', label: 'Exceptions', icon: '⚠️' },
  { type: 'query', label: 'Queries', icon: '🗃️' },
  { type: 'log', label: 'Logs', icon: '📋' },
  { type: 'job', label: 'Jobs', icon: '⚙️' },
  { type: 'mail', label: 'Mail', icon: '✉️' },
  { type: 'notification', label: 'Notifications', icon: '🔔' },
  { type: 'cache', label: 'Cache', icon: '💾' },
  { type: 'dump', label: 'Dumps', icon: '🔻' },
  { type: 'schedule', label: 'Schedule', icon: '⏰' },
  { type: 'command', label: 'Commands', icon: '⌘' },
  { type: 'gate', label: 'Gates', icon: '🔑' },
  { type: 'model', label: 'Models', icon: '📦' },
  { type: 'event', label: 'Events', icon: '📡' },
  { type: 'view', label: 'Views', icon: '👁️' },
  { type: 'redis', label: 'Redis', icon: '🔺' },
  { type: 'batch', label: 'Batches', icon: '🎛️' }
]

const CONFIG_BY_TYPE = new Map(TYPE_CONFIGS.map((c) => [c.type, c]))

/** Config for a type, with a safe fallback for unknown/future types. */
export function typeConfig(type: string): TypeConfig {
  return CONFIG_BY_TYPE.get(type as TelescopeType) ?? { type: type as TelescopeType, label: type, icon: '•' }
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
