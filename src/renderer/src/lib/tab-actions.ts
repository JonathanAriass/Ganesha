// src/renderer/src/lib/tab-actions.ts
/** Imperative run handlers for each mounted QueryTab, so each pane's environment
 *  bar can drive that pane's tab. Same thunk-registry pattern as the Monaco
 *  completion ctxByModel map: QueryTab registers a getter that reads a ref, so
 *  the registry always sees the freshest closures without re-registering. */

export interface TabActions {
  /** ⌘↵ semantics: selection → statement at cursor → whole tab. */
  run: () => void
  runAll: () => void
  /** Re-run lastRunText (the Refresh button). */
  refresh: () => void
}

const byTab = new Map<string, () => TabActions>()

export function setTabActions(tabId: string, get: () => TabActions): void {
  byTab.set(tabId, get)
}

export function clearTabActions(tabId: string): void {
  byTab.delete(tabId)
}

export function getTabActions(tabId: string): TabActions | null {
  return byTab.get(tabId)?.() ?? null
}
