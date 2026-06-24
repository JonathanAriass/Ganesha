import { create } from 'zustand'
import type { SessionTab } from '@shared/domain'
import type { QueryResult } from '@shared/query'
import { buildRowEdits } from '../lib/edit-staging'
import { parseEditKey, setAtPath } from '../lib/doc-path'
import { unwrap } from '../lib/result'
import { type CloseMode } from '../lib/tab-close'
import { type PaneId, otherPane, normalizePanes, nextActiveInPane, applyPaneClose } from '../lib/panes'
import { applyTabReorder, type TabMove } from '../lib/tab-reorder'

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
  /** Tab kind. Absent/`'query'` = the normal editor+results tab; `'diagram'` = the read-only schema
   *  diagram (query fields stay at their empties and are unused). */
  kind?: 'query' | 'diagram'
  /** Which side of a split this tab lives in. Defaults to `'left'`; only ever `'right'`
   *  while a split is open. `tabs.some(t => t.pane === 'right')` IS "is the view split". */
  pane: PaneId
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

  // ── SSM tunnels ───────────────────────────────────────────────────────────
  ssmOpen: boolean
  /** Ids of SSM tunnels whose process is running (kept live by the ssm:status subscription). */
  runningSsm: string[]
  toggleSsm: () => void
  setSsmRunning: (ids: string[]) => void
  markSsm: (id: string, running: boolean) => void

  // ── LLM assistant ─────────────────────────────────────────────────────────
  assistantOpen: boolean
  activeConversationId: string | null
  modelManagerOpen: boolean

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabs: QueryTabData[]
  activeTabId: string | null
  /** Last-active tab per connection — restores your spot when switching back to a server group. */
  lastActiveByConnection: Record<string, string>
  focusedPane: PaneId
  activeTabByPane: Record<PaneId, string | null>
  activeConnByPane: Record<PaneId, string | null>
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
  /** Open (or focus the existing) read-only schema-diagram tab for a connection. */
  openDiagramTab: (connectionId: string) => void
  /** One-shot boot restore of a persisted session. No-ops once any tab exists —
   *  it must never clobber tabs the user opened before the IPC round-trip landed. */
  hydrateTabs: (sessionTabs: SessionTab[]) => void
  closeTab: (id: string) => void
  closeTabsForConnection: (connectionId: string) => void
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  closeTabsToLeft: (id: string) => void
  closeAllTabs: (id: string) => void
  setActiveTab: (id: string) => void
  /** Rename a tab (trimmed). Empty/whitespace titles are rejected — the tab keeps its name. */
  renameTab: (id: string, title: string) => void
  setTabText: (id: string, text: string) => void
  loadQueryText: (id: string, text: string) => void
  /** Load text into the active tab when it belongs to `connectionId`, else open a new tab. */
  openOrLoadQuery: (args: { connectionId: string; title: string; text: string }) => void
  /** Open a table query. If a tab for that same table is already open it's focused (no duplicate);
   *  otherwise a fresh tab opens and runs. Opening one table never replaces another's tab. */
  openTableQuery: (args: { connectionId: string; title: string; text: string }) => void
  /** Peel the focused pane's active tab onto the other side (or, if that pane has only one
   *  tab, open a fresh tab on the other side). Always ends in a visible two-pane split. */
  splitActiveTab: () => void
  /** Move a specific tab to the other pane and focus the destination. */
  moveTabToOtherPane: (id: string) => void
  /** Drag-and-drop relocation: move a tab into a pane at the drop position (before `beforeId`,
   *  or appended). Reorders within a pane and moves across panes; collapses an emptied side. */
  reorderTab: (move: TabMove) => void
  /** Focus a pane (no-op if it has no tabs). */
  focusPane: (pane: PaneId) => void
  startRun: (id: string, queryId: string) => void
  finishRun: (id: string, payload: { result: QueryResult } | { error: string }) => void
  /** After a committed edit, write each value at its field path into the tab's result —
   *  the row cell (top-level column) and the documents array (nested path). Immutable. */
  applyResultEdits: (id: string, edits: { rowIndex: number; path: string; value: unknown }[]) => void
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

/** Apply a pane-aware bulk close and drop a commit modal whose tab no longer survives. */
function closeTabsResult(s: AppState, mode: CloseMode, targetId: string) {
  const r = applyPaneClose(s.tabs, s.activeTabByPane, s.focusedPane, mode, targetId)
  // Each pane's active connection follows its (possibly new) active tab.
  const connFor = (id: string | null): string | null =>
    id ? (r.tabs.find((t) => t.id === id)?.connectionId ?? null) : null
  return withMirror({
    tabs: r.tabs,
    focusedPane: r.focusedPane,
    activeTabByPane: r.activeByPane,
    activeConnByPane: { left: connFor(r.activeByPane.left), right: connFor(r.activeByPane.right) },
    commitModal: r.tabs.some((t) => t.id === s.commitModal?.tabId) ? s.commitModal : null,
  })
}

/** A fresh tab with every volatile field at its empty. Callers override what they need. */
function blankTab(fields: {
  connectionId: string
  title: string
  pane: PaneId
  text?: string
  kind?: 'query' | 'diagram'
  runOnOpen?: boolean
}): QueryTabData {
  return {
    id: crypto.randomUUID(),
    connectionId: fields.connectionId,
    title: fields.title,
    kind: fields.kind,
    pane: fields.pane,
    text: fields.text ?? '',
    epoch: 0,
    runOnOpen: fields.runOnOpen ?? false,
    running: false,
    queryId: null,
    result: null,
    error: null,
    scriptRun: null,
    edits: {},
    editError: null,
  }
}

/** Recompute the focused-pane mirrors (`activeTabId`/`activeConnectionId`) from the per-pane
 *  maps. Every action that changes panes/active/focus spreads this so the sidebar, global
 *  shortcuts, and persistence keep reading the two legacy fields unchanged. */
function withMirror<S extends {
  focusedPane: PaneId
  activeTabByPane: Record<PaneId, string | null>
  activeConnByPane: Record<PaneId, string | null>
}>(next: S): S & { activeTabId: string | null; activeConnectionId: string | null } {
  return {
    ...next,
    activeTabId: next.activeTabByPane[next.focusedPane],
    activeConnectionId: next.activeConnByPane[next.focusedPane],
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  activeConnectionId: null,
  connectionModal: null,
  settingsOpen: false,
  paletteOpen: false,
  saveQueryModal: null,
  commitModal: null,
  ssmOpen: false,
  runningSsm: [],
  assistantOpen: false,
  activeConversationId: null,
  modelManagerOpen: false,
  tabs: [],
  activeTabId: null,
  lastActiveByConnection: {},
  focusedPane: 'left',
  activeTabByPane: { left: null, right: null },
  activeConnByPane: { left: null, right: null },
  _queryCounter: 0,

  setActiveConnection: (id) =>
    set((s) => {
      const p = s.focusedPane
      if (id === null) {
        return withMirror({
          focusedPane: p,
          activeTabByPane: { ...s.activeTabByPane, [p]: null },
          activeConnByPane: { ...s.activeConnByPane, [p]: null },
        })
      }
      const inPane = s.tabs.filter((t) => t.pane === p && t.connectionId === id)
      const remembered = s.lastActiveByConnection[id]
      const tabId = remembered && inPane.some((t) => t.id === remembered)
        ? remembered
        : (inPane[0]?.id ?? null)
      return withMirror({
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: tabId },
        activeConnByPane: { ...s.activeConnByPane, [p]: id },
        lastActiveByConnection: tabId ? { ...s.lastActiveByConnection, [id]: tabId } : s.lastActiveByConnection,
      })
    }),
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

  toggleSsm: () => set((s) => ({ ssmOpen: !s.ssmOpen })),
  setSsmRunning: (ids) => set({ runningSsm: ids }),
  markSsm: (id, running) =>
    set((s) => ({
      runningSsm: running ? [...new Set([...s.runningSsm, id])] : s.runningSsm.filter((x) => x !== id)
    })),

  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  openModelManager: () => set({ modelManagerOpen: true }),
  closeModelManager: () => set({ modelManagerOpen: false }),

  openQueryTab: ({ connectionId, title, text, runOnOpen }) =>
    set((s) => {
      const n = s._queryCounter + 1
      const p = s.focusedPane
      const tab = blankTab({ connectionId, title: title ?? `Query ${n}`, text, runOnOpen, pane: p })
      return withMirror({
        tabs: [...s.tabs, tab],
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: tab.id },
        activeConnByPane: { ...s.activeConnByPane, [p]: connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [connectionId]: tab.id },
        _queryCounter: n,
      })
    }),

  openDiagramTab: (connectionId) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.connectionId === connectionId && t.kind === 'diagram')
      if (existing) {
        return withMirror({
          focusedPane: existing.pane,
          activeTabByPane: { ...s.activeTabByPane, [existing.pane]: existing.id },
          activeConnByPane: { ...s.activeConnByPane, [existing.pane]: connectionId },
          lastActiveByConnection: { ...s.lastActiveByConnection, [connectionId]: existing.id },
        })
      }
      const p = s.focusedPane
      const tab = blankTab({ connectionId, title: '◇ Schema', kind: 'diagram', pane: p })
      return withMirror({
        tabs: [...s.tabs, tab],
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: tab.id },
        activeConnByPane: { ...s.activeConnByPane, [p]: connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [connectionId]: tab.id },
      })
    }),

  hydrateTabs: (sessionTabs) =>
    set((s) => {
      if (s.tabs.length > 0 || sessionTabs.length === 0) return s
      const tabs: QueryTabData[] = sessionTabs.map((st) => {
        const tab = blankTab({
          connectionId: st.connectionId,
          title: st.title,
          text: st.text,
          pane: st.pane === 'right' ? 'right' : 'left', // legacy rows (undefined) → left
        })
        tab.id = st.id // keep persisted ids stable (session-save matches on them)
        return tab
      })
      // Bump the counter past restored "Query N" titles so new tabs don't duplicate them.
      const counter = tabs.reduce((max, t) => {
        const m = /^Query (\d+)$/.exec(t.title)
        return m ? Math.max(max, Number(m[1])) : max
      }, s._queryCounter)
      // Each pane's active = its flagged session tab, else the pane's first tab. Focus always
      // returns to the left pane on restore (we don't persist focus; left is non-empty when tabs exist).
      const activeIn = (p: PaneId): string | null => {
        const flagged = sessionTabs.find((st) => (st.pane === 'right' ? 'right' : 'left') === p && st.active)
        return flagged?.id ?? tabs.find((t) => t.pane === p)?.id ?? null
      }
      const activeTabByPane = { left: activeIn('left'), right: activeIn('right') }
      const connFor = (id: string | null): string | null =>
        id ? (tabs.find((t) => t.id === id)?.connectionId ?? null) : null
      const lastActive: Record<string, string> = {}
      for (const p of ['left', 'right'] as PaneId[]) {
        const id = activeTabByPane[p]
        const conn = connFor(id)
        if (id && conn) lastActive[conn] = id
      }
      return withMirror({
        tabs,
        _queryCounter: counter,
        focusedPane: 'left',
        activeTabByPane,
        activeConnByPane: { left: connFor(activeTabByPane.left), right: connFor(activeTabByPane.right) },
        lastActiveByConnection: lastActive,
      })
    }),

  // Single close (× / ⌘W / menu "Close") — group-aware: reselects the adjacent tab in the SAME
  // group, else another group's first tab, else null. Drops a stale commit modal (its overlay
  // guard would otherwise swallow every shortcut with nothing on screen).
  closeTab: (id) => set((s) => closeTabsResult(s, 'self', id)),

  closeTabsForConnection: (connectionId) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.connectionId !== connectionId)
      if (remaining.length === s.tabs.length) return s
      const norm = normalizePanes(remaining)
      const pick = (p: PaneId): string | null => {
        const cur = s.activeTabByPane[p]
        if (cur && norm.tabs.some((t) => t.id === cur && t.pane === p)) return cur
        return norm.tabs.find((t) => t.pane === p)?.id ?? null
      }
      const activeTabByPane = { left: pick('left'), right: norm.hasRight ? pick('right') : null }
      const connFor = (id: string | null): string | null =>
        id ? (norm.tabs.find((t) => t.id === id)?.connectionId ?? null) : null
      const focusedPane: PaneId =
        norm.tabs.some((t) => t.pane === s.focusedPane) ? s.focusedPane : 'left'
      const commitModal = norm.tabs.some((t) => t.id === s.commitModal?.tabId) ? s.commitModal : null
      return withMirror({
        tabs: norm.tabs,
        focusedPane,
        activeTabByPane,
        activeConnByPane: { left: connFor(activeTabByPane.left), right: connFor(activeTabByPane.right) },
        commitModal,
      })
    }),

  closeOtherTabs: (id) => set((s) => closeTabsResult(s, 'others', id)),
  closeTabsToRight: (id) => set((s) => closeTabsResult(s, 'right', id)),
  closeTabsToLeft: (id) => set((s) => closeTabsResult(s, 'left', id)),
  closeAllTabs: (id) => set((s) => closeTabsResult(s, 'all', id)),

  setActiveTab: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const p = tab.pane
      return withMirror({
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: id },
        activeConnByPane: { ...s.activeConnByPane, [p]: tab.connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [tab.connectionId]: id },
      })
    }),

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
    // Reuse the active tab only if it's a query tab for this connection (never a diagram tab).
    if (activeTab && activeTab.connectionId === connectionId && activeTab.kind !== 'diagram') s.loadQueryText(activeTab.id, text)
    else s.openQueryTab({ connectionId, title, text })
  },

  openTableQuery: ({ connectionId, title, text }) => {
    const s = get()
    // Avoid a DUPLICATE tab for the same table: if one is already open (matched by connection + the
    // table's name as title), just focus it. A different table keeps its own tab open — opening one
    // table never replaces another.
    const existing = s.tabs.find((t) => t.connectionId === connectionId && t.kind !== 'diagram' && t.title === title)
    if (existing) {
      s.setActiveTab(existing.id)
      return
    }
    s.openQueryTab({ connectionId, title, text, runOnOpen: true })
  },

  splitActiveTab: () =>
    set((s) => {
      const src = s.focusedPane
      const dst = otherPane(src)
      const activeId = s.activeTabByPane[src]
      if (!activeId) return s // button is disabled in this state, but guard anyway
      const srcCount = s.tabs.filter((t) => t.pane === src).length
      if (srcCount >= 2) {
        // Peel the active tab across.
        const tabs = s.tabs.map((t) => (t.id === activeId ? { ...t, pane: dst } : t))
        const moved = tabs.find((t) => t.id === activeId)!
        const srcActiveId = nextActiveInPane(tabs, src, activeId)
        const srcConn = srcActiveId ? tabs.find((t) => t.id === srcActiveId)!.connectionId : s.activeConnByPane[src]
        return withMirror({
          tabs,
          focusedPane: dst,
          activeTabByPane: { ...s.activeTabByPane, [src]: srcActiveId, [dst]: activeId },
          activeConnByPane: { ...s.activeConnByPane, [src]: srcConn, [dst]: moved.connectionId },
        })
      }
      // Source has a single tab — open a fresh one on the other side instead (keeps the split).
      const moved = s.tabs.find((t) => t.id === activeId)!
      const n = s._queryCounter + 1
      const tab = blankTab({ connectionId: moved.connectionId, title: `Query ${n}`, pane: dst })
      return withMirror({
        tabs: [...s.tabs, tab],
        focusedPane: dst,
        activeTabByPane: { ...s.activeTabByPane, [dst]: tab.id },
        activeConnByPane: { ...s.activeConnByPane, [dst]: moved.connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [moved.connectionId]: tab.id },
        _queryCounter: n,
      })
    }),

  moveTabToOtherPane: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const src = tab.pane
      const dst = otherPane(src)
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, pane: dst } : t))
      // Reselect the source pane's active if we moved its active tab; normalize for collapse.
      const srcActive = s.activeTabByPane[src] === id ? nextActiveInPane(tabs, src, id) : s.activeTabByPane[src]
      const norm = normalizePanes(tabs)
      const reHomed = !norm.hasRight && tabs.some((t) => t.pane === 'right')
      if (!norm.hasRight) {
        // Moving emptied a pane and collapsed — everything is left now.
        return withMirror({
          tabs: norm.tabs,
          focusedPane: 'left',
          activeTabByPane: { left: reHomed ? id : (srcActive ?? id), right: null },
          activeConnByPane: { ...s.activeConnByPane, left: tab.connectionId, right: null },
        })
      }
      const srcConn = srcActive ? tabs.find((t) => t.id === srcActive)!.connectionId : s.activeConnByPane[src]
      return withMirror({
        tabs: norm.tabs,
        focusedPane: dst,
        activeTabByPane: { ...s.activeTabByPane, [src]: srcActive, [dst]: id },
        activeConnByPane: { ...s.activeConnByPane, [src]: srcConn, [dst]: tab.connectionId },
      })
    }),

  reorderTab: (move) =>
    set((s) => {
      const r = applyTabReorder(s.tabs, s.activeTabByPane, s.focusedPane, move)
      if (r.tabs === s.tabs) return s // no-op: unknown id, self-drop, or dropped in place
      // Each pane's active connection follows its (possibly new) active tab — recomputed from
      // the survivor, so a multi-connection pane never keeps a stale connection.
      const connFor = (id: string | null): string | null =>
        id ? (r.tabs.find((t) => t.id === id)?.connectionId ?? null) : null
      return withMirror({
        tabs: r.tabs,
        focusedPane: r.focusedPane,
        activeTabByPane: r.activeByPane,
        activeConnByPane: { left: connFor(r.activeByPane.left), right: connFor(r.activeByPane.right) },
      })
    }),

  focusPane: (pane) =>
    set((s) => {
      if (s.focusedPane === pane) return s // already focused — avoid a needless notify
      if (!s.tabs.some((t) => t.pane === pane)) return s // empty pane can't take focus
      return withMirror({
        focusedPane: pane,
        activeTabByPane: s.activeTabByPane,
        activeConnByPane: s.activeConnByPane,
      })
    }),

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
        const result = t.result
        const touched = new Set(edits.map((e) => e.rowIndex))
        // Mongo results carry a parallel `documents` array (the JSON/tree view reads it),
        // index-aligned with rows; patch each edited field by its (possibly nested) path so
        // that view doesn't show stale values after a commit.
        const documents = result.documents
          ? result.documents.map((doc, i) => {
              if (!touched.has(i)) return doc
              let next = doc
              for (const e of edits) if (e.rowIndex === i) next = setAtPath(next, e.path, e.value)
              return next
            })
          : null
        const rows = result.rows.map((row, i) => {
          if (!touched.has(i)) return row
          // Mongo: the table rows are the flattened documents — rebuild a touched row from
          // its patched doc so a NESTED edit also refreshes its top-level column cell.
          if (documents) {
            const doc = documents[i]
            return result.columns.map((c) => (c.name in doc ? doc[c.name] : null))
          }
          // SQL: patch the cell at each top-level path (= column name).
          const next = row.slice()
          for (const e of edits) {
            const colIndex = result.columns.findIndex((c) => c.name === e.path)
            if (colIndex >= 0) next[colIndex] = e.value
          }
          return next
        })
        return { ...t, result: { ...result, rows, documents } }
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
        const { rowIndex, path } = parseEditKey(k)
        return { rowIndex, path, value }
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
