/** Shell UI preferences (tab-strip scope, collapsed sidebar groups). Same precedent
 *  as side-panel.ts: localStorage is the source of truth, every function takes an
 *  injectable storage, and garbage heals to the default. */

export type TabScope = 'all' | 'connection'

const TAB_SCOPE_KEY = 'tab-scope'
const COLLAPSED_KEY = 'sidebar-collapsed-groups'
const SPLIT_KEY = 'sidebar-split'

/** Share of the sidebar's height the Connections zone may take before it scrolls. */
export const SIDEBAR_SPLIT_DEFAULT = 0.45
export const SIDEBAR_SPLIT_MIN = 0.15
export const SIDEBAR_SPLIT_MAX = 0.75

type ReadStore = Pick<Storage, 'getItem'>
type WriteStore = Pick<Storage, 'setItem'>

/** Modules load at import time in node-env tests — no localStorage there. */
function safeLocal(): (ReadStore & WriteStore) | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function loadTabScope(storage: ReadStore | null = safeLocal()): TabScope {
  return storage?.getItem(TAB_SCOPE_KEY) === 'connection' ? 'connection' : 'all'
}

export function saveTabScope(s: TabScope, storage: WriteStore | null = safeLocal()): void {
  storage?.setItem(TAB_SCOPE_KEY, s)
}

export function loadCollapsedGroups(storage: ReadStore | null = safeLocal()): string[] {
  const raw = storage?.getItem(COLLAPSED_KEY)
  if (raw == null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveCollapsedGroups(ids: string[], storage: WriteStore | null = safeLocal()): void {
  storage?.setItem(COLLAPSED_KEY, JSON.stringify(ids))
}

export function clampSidebarSplit(f: number): number {
  if (!Number.isFinite(f)) return SIDEBAR_SPLIT_DEFAULT
  return Math.min(SIDEBAR_SPLIT_MAX, Math.max(SIDEBAR_SPLIT_MIN, f))
}

/** The split for a pointer at `clientY` inside a sidebar spanning `top`..`top + height`. */
export function dragSidebarSplit(clientY: number, top: number, height: number): number {
  return height > 0 ? clampSidebarSplit((clientY - top) / height) : SIDEBAR_SPLIT_DEFAULT
}

export function loadSidebarSplit(storage: ReadStore | null = safeLocal()): number {
  const raw = storage?.getItem(SPLIT_KEY)
  if (raw == null || raw.trim() === '') return SIDEBAR_SPLIT_DEFAULT
  return clampSidebarSplit(Number(raw))
}

export function saveSidebarSplit(f: number, storage: WriteStore | null = safeLocal()): void {
  storage?.setItem(SPLIT_KEY, String(clampSidebarSplit(f)))
}
