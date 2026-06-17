import { create } from 'zustand'
import type { SessionTab } from '@shared/domain'
import type { QueryResult } from '@shared/query'
import { buildRowEdits } from '../lib/edit-staging'
import { unwrap } from '../lib/result'

type ConnectionModalState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }

export type SaveQueryModalState =
  | { mode: 'create'; connectionId: string; query: string }
  | { mode: 'rename'; id: string; name: string }

/** One statement's outcome within a Run-all script. */
export interface ScriptStatementResult {
  /** The statement's source text (snippet display + tooltips). */
  text: string
  result: QueryResult | null
  error: string | null
  /** True for statements never attempted — an earlier one failed, or Cancel
   *  stopped the script at a statement boundary. */
  skipped: boolean
}

/** A Run-all execution: entries grow as statements finish; the script is still
 *  running while the owning tab's `running` is true. */
export interface ScriptRun {
  /** Unique per Run-all — keys the results view so a new run remounts every
   *  section (fresh open/closed defaults) instead of reusing the old ones. */
  runId: string
  /** Set by Cancel; the script loop checks it at every statement boundary.
   *  Store state, not component state: QueryTab remounts on tab switches
   *  while the script keeps running, so a ref on the instance would go dead. */
  stopRequested: boolean
  total: number
  entries: ScriptStatementResult[]
}

export interface QueryTabData {
  id: string
  connectionId: string
  title: string
  text: string
  /** Bumped when text is replaced programmatically (history load) to remount the editor. */
  epoch: number
  runOnOpen: boolean
  running: boolean
  queryId: string | null
  result: QueryResult | null
  error: string | null
  /** Exactly one of result/error/scriptRun is current — each run path clears the others. */
  scriptRun: ScriptRun | null
  /** Staged (uncommitted) results-grid cell edits, keyed `rowId:colIndex`. Transient —
   *  never persisted; cleared whenever a new result lands. */
  edits: Record<string, unknown>
  /** Last edit-commit error, shown in the grid's commit bar. */
  editError: string | null
}

interface AppState {
  activeConnectionId: string | null
  connectionModal: ConnectionModalState | null
  settingsOpen: boolean
  paletteOpen: boolean
  saveQueryModal: SaveQueryModalState | null
  /** Tab whose staged edits are pending a commit-confirmation review, or null. */
  commitModal: { tabId: string } | null

  // ── LLM assistant ─────────────────────────────────────────────────────────
  assistantOpen: boolean
  activeConversationId: string | null
  modelManagerOpen: boolean

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabs: QueryTabData[]
  activeTabId: string | null
  _queryCounter: number

  setActiveConnection: (id: string | null) => void
  openModal: (state: ConnectionModalState) => void
  closeModal: () => void

  openSettings: () => void
  closeSettings: () => void
  setPaletteOpen: (open: boolean) => void
  openSaveQueryModal: (state: SaveQueryModalState) => void
  closeSaveQueryModal: () => void
  /** Open the commit-confirmation review for a tab's staged edits. */
  openCommitModal: (tabId: string) => void
  closeCommitModal: () => void

  toggleAssistant: () => void
  setActiveConversation: (id: string | null) => void
  openModelManager: () => void
  closeModelManager: () => void

  openQueryTab: (args: { connectionId: string; title?: string; text?: string; runOnOpen?: boolean }) => void
  /** One-shot boot restore of a persisted session. No-ops once any tab exists —
   *  it must never clobber tabs the user opened before the IPC round-trip landed. */
  hydrateTabs: (sessionTabs: SessionTab[]) => void
  closeTab: (id: string) => void
  closeTabsForConnection: (connectionId: string) => void
  setActiveTab: (id: string) => void
  /** Rename a tab (trimmed). Empty/whitespace titles are rejected — the tab keeps its name. */
  renameTab: (id: string, title: string) => void
  setTabText: (id: string, text: string) => void
  loadQueryText: (id: string, text: string) => void
  /** Load text into the active tab when it belongs to `connectionId`, else open a new tab. */
  openOrLoadQuery: (args: { connectionId: string; title: string; text: string }) => void
  startRun: (id: string, queryId: string) => void
  finishRun: (id: string, payload: { result: QueryResult } | { error: string }) => void
  /** Rewrite specific cells in a tab's result rows after a committed edit (immutable). */
  applyResultEdits: (id: string, edits: { rowIndex: number; colIndex: number; value: unknown }[]) => void
  /** Stage one cell edit (keyed `rowId:colIndex`). */
  setCellEdit: (tabId: string, key: string, value: unknown) => void
  /** Drop one staged cell edit (per-cell reset). */
  resetCellEdit: (tabId: string, key: string) => void
  /** Drop all staged edits for a tab. */
  discardEdits: (tabId: string) => void
  /** Write the staged edits to the database (one batch), then adopt the new values. */
  commitEdits: (tabId: string) => Promise<void>

  // ── Run all (script execution) ────────────────────────────────────────────
  startScript: (id: string, total: number, runId: string) => void
  /** Ask the running script to stop at the next statement boundary — the cancel
   *  IPC alone can miss (drivers no-op on a queryId that just finished). */
  requestScriptStop: (id: string) => void
  /** Point the tab's queryId at the in-flight statement so Cancel targets it. */
  scriptStatementStart: (id: string, queryId: string) => void
  scriptStatementDone: (id: string, entry: ScriptStatementResult) => void
  finishScript: (id: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  activeConnectionId: null,
  connectionModal: null,
  settingsOpen: false,
  paletteOpen: false,
  saveQueryModal: null,
  commitModal: null,
  assistantOpen: false,
  activeConversationId: null,
  modelManagerOpen: false,
  tabs: [],
  activeTabId: null,
  _queryCounter: 0,

  setActiveConnection: (id) => set({ activeConnectionId: id }),
  openModal: (state) => set({ connectionModal: state }),
  closeModal: () => set({ connectionModal: null }),

  openSettings: () => set({ settingsOpen: true, paletteOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  // Like openSettings: an overlay opening from the palette must replace it.
  openSaveQueryModal: (state) => set({ saveQueryModal: state, paletteOpen: false }),
  closeSaveQueryModal: () => set({ saveQueryModal: null }),

  openCommitModal: (tabId) => set({ commitModal: { tabId } }),
  closeCommitModal: () => set({ commitModal: null }),

  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  openModelManager: () => set({ modelManagerOpen: true }),
  closeModelManager: () => set({ modelManagerOpen: false }),

  openQueryTab: ({ connectionId, title, text, runOnOpen }) =>
    set((s) => {
      const n = s._queryCounter + 1
      const tab: QueryTabData = {
        id: crypto.randomUUID(),
        connectionId,
        title: title ?? `Query ${n}`,
        text: text ?? '',
        epoch: 0,
        runOnOpen: runOnOpen ?? false,
        running: false,
        queryId: null,
        result: null,
        error: null,
        scriptRun: null,
        edits: {},
        editError: null,
      }
      return { tabs: [...s.tabs, tab], activeTabId: tab.id, _queryCounter: n }
    }),

  hydrateTabs: (sessionTabs) =>
    set((s) => {
      if (s.tabs.length > 0 || sessionTabs.length === 0) return s
      // Volatile state (results, errors, run state) never persists — restored
      // tabs come back clean, with their persisted ids kept stable.
      const tabs: QueryTabData[] = sessionTabs.map((t) => ({
        id: t.id,
        connectionId: t.connectionId,
        title: t.title,
        text: t.text,
        epoch: 0,
        runOnOpen: false,
        running: false,
        queryId: null,
        result: null,
        error: null,
        scriptRun: null,
        edits: {},
        editError: null,
      }))
      // Bump the counter past restored "Query N" titles so new tabs don't duplicate them.
      const counter = tabs.reduce((max, t) => {
        const m = /^Query (\d+)$/.exec(t.title)
        return m ? Math.max(max, Number(m[1])) : max
      }, s._queryCounter)
      const active = tabs.find((t, i) => sessionTabs[i].active) ?? tabs[tabs.length - 1]
      return {
        tabs,
        activeTabId: active.id,
        _queryCounter: counter,
        // Point the sidebar at the restored tab's connection (QueryTab auto-connects it anyway).
        activeConnectionId: s.activeConnectionId ?? active.connectionId,
      }
    }),

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const next = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (activeTabId === id) {
        // prefer the tab after, else the one before, else null
        const neighbor = s.tabs[idx + 1] ?? s.tabs[idx - 1] ?? null
        activeTabId = neighbor ? neighbor.id : null
      }
      // Drop a commit modal whose tab is gone, or its overlay guard would silently
      // swallow every shortcut with nothing visible on screen.
      const commitModal = next.some((t) => t.id === s.commitModal?.tabId) ? s.commitModal : null
      return { tabs: next, activeTabId, commitModal }
    }),

  closeTabsForConnection: (connectionId) =>
    set((s) => {
      const next = s.tabs.filter((t) => t.connectionId !== connectionId)
      if (next.length === s.tabs.length) return s
      const stillActive = next.some((t) => t.id === s.activeTabId)
      const commitModal = next.some((t) => t.id === s.commitModal?.tabId) ? s.commitModal : null
      return { tabs: next, activeTabId: stillActive ? s.activeTabId : (next[0]?.id ?? null), commitModal }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  renameTab: (id, title) =>
    set((s) => {
      const t = title.trim()
      if (!t) return s
      return { tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, title: t } : tab)) }
    }),

  setTabText: (id, text) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, text } : t)),
    })),

  loadQueryText: (id, text) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, text, epoch: t.epoch + 1 } : t)),
    })),

  openOrLoadQuery: ({ connectionId, title, text }) => {
    const s = get()
    const activeTab = s.tabs.find((t) => t.id === s.activeTabId)
    if (activeTab && activeTab.connectionId === connectionId) s.loadQueryText(activeTab.id, text)
    else s.openQueryTab({ connectionId, title, text })
  },

  startRun: (id, queryId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        // scriptRun cleared: a single run supersedes a previous script's results.
        // Staged edits belong to the old result, so they're dropped on a new run.
        t.id === id ? { ...t, running: true, error: null, queryId, runOnOpen: false, scriptRun: null, edits: {}, editError: null } : t
      ),
    })),

  finishRun: (id, payload) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t
        if ('result' in payload)
          return { ...t, running: false, queryId: null, result: payload.result, error: null, scriptRun: null, edits: {}, editError: null }
        return { ...t, running: false, queryId: null, error: payload.error, result: null, scriptRun: null, edits: {}, editError: null }
      }),
    })),

  applyResultEdits: (id, edits) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id || !t.result) return t
        const touched = new Set(edits.map((e) => e.rowIndex))
        const rows = t.result.rows.map((row, i) => {
          if (!touched.has(i)) return row
          const next = row.slice()
          for (const e of edits) if (e.rowIndex === i) next[e.colIndex] = e.value
          return next
        })
        return { ...t, result: { ...t.result, rows } }
      }),
    })),

  setCellEdit: (tabId, key, value) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, edits: { ...t.edits, [key]: value }, editError: null } : t)),
    })),

  resetCellEdit: (tabId, key) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const edits = { ...t.edits }
        delete edits[key]
        return { ...t, edits }
      }),
    })),

  discardEdits: (tabId) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, edits: {}, editError: null } : t)) })),

  commitEdits: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab || !tab.result?.editable || Object.keys(tab.edits).length === 0) return
    const editable = tab.result.editable
    const rows = tab.result.rows
    try {
      const rowEdits = buildRowEdits(tab.edits, rows, editable)
      await window.api.edits.apply({ connectionId: tab.connectionId, table: editable.table, rows: rowEdits }).then(unwrap)
      // The write succeeded against the rows the user saw. If a new query for this tab
      // finished mid-commit, it already replaced the result (and cleared edits) — don't
      // adopt the values into the fresh result's rows.
      if (get().tabs.find((t) => t.id === tabId)?.result?.rows !== rows) return
      const applied = Object.entries(tab.edits).map(([k, value]) => {
        const [rowIndex, colIndex] = k.split(':').map(Number)
        return { rowIndex, colIndex, value }
      })
      get().applyResultEdits(tabId, applied)
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, edits: {}, editError: null } : t)) }))
    } catch (e) {
      // Leave the staged edits intact so the user can retry or reset.
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, editError: e instanceof Error ? e.message : String(e) } : t)) }))
    }
  },

  startScript: (id, total, runId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              running: true,
              error: null,
              result: null,
              queryId: null,
              runOnOpen: false,
              scriptRun: { runId, total, entries: [], stopRequested: false },
              edits: {},
              editError: null,
            }
          : t
      ),
    })),

  requestScriptStop: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.scriptRun
          ? { ...t, scriptRun: { ...t.scriptRun, stopRequested: true } }
          : t
      ),
    })),

  scriptStatementStart: (id, queryId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, queryId } : t)),
    })),

  scriptStatementDone: (id, entry) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.scriptRun
          ? { ...t, scriptRun: { ...t.scriptRun, entries: [...t.scriptRun.entries, entry] } }
          : t
      ),
    })),

  finishScript: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, running: false, queryId: null } : t)),
    })),
}))
