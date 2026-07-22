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

// Colors chosen to step clearly around the hue wheel (no two neighbours share a family) so the 17
// types stay distinguishable as small dots + faint row tints on both themes.
export const TYPE_CONFIGS: TypeConfig[] = [
  { type: 'request', label: 'Requests', icon: '🌐', color: '#2196f3' }, // blue
  { type: 'exception', label: 'Exceptions', icon: '⚠️', color: '#ef5350' }, // red
  { type: 'query', label: 'Queries', icon: '🗃️', color: '#00bcd4' }, // cyan
  { type: 'log', label: 'Logs', icon: '📋', color: '#ab47bc' }, // purple
  { type: 'job', label: 'Jobs', icon: '⚙️', color: '#ff9800' }, // orange
  { type: 'mail', label: 'Mail', icon: '✉️', color: '#ec407a' }, // pink
  { type: 'notification', label: 'Notifications', icon: '🔔', color: '#26a69a' }, // teal
  { type: 'cache', label: 'Cache', icon: '💾', color: '#4caf50' }, // green
  { type: 'dump', label: 'Dumps', icon: '🔻', color: '#9e9e9e' }, // gray
  { type: 'schedule', label: 'Schedule', icon: '⏰', color: '#3f51b5' }, // indigo
  { type: 'command', label: 'Commands', icon: '⌘', color: '#ffca28' }, // amber
  { type: 'gate', label: 'Gates', icon: '🔑', color: '#d500f9' }, // magenta
  { type: 'model', label: 'Models', icon: '📦', color: '#9ccc65' }, // light green
  { type: 'event', label: 'Events', icon: '📡', color: '#7e57c2' }, // deep purple
  { type: 'view', label: 'Views', icon: '👁️', color: '#29b6f6' }, // light blue
  { type: 'redis', label: 'Redis', icon: '🔺', color: '#ff7043' }, // deep orange
  { type: 'batch', label: 'Batches', icon: '🎛️', color: '#8d6e63' } // brown
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
