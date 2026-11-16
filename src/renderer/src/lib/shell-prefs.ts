/** Shell UI preferences (tab-strip scope, collapsed sidebar groups). Same precedent
 *  as side-panel.ts: localStorage is the source of truth, every function takes an
 *  injectable storage, and garbage heals to the default. */

export type TabScope = 'all' | 'connection'

const TAB_SCOPE_KEY = 'tab-scope'
const COLLAPSED_KEY = 'sidebar-collapsed-groups'

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
