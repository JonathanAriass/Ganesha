import { create } from 'zustand'
import type { QueryResult } from '@shared/query'

type ConnectionModalState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }

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
}

interface AppState {
  activeConnectionId: string | null
  connectionModal: ConnectionModalState | null

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabs: QueryTabData[]
  activeTabId: string | null
  _queryCounter: number

  setActiveConnection: (id: string | null) => void
  openModal: (state: ConnectionModalState) => void
  closeModal: () => void

  openQueryTab: (args: { connectionId: string; title?: string; text?: string; runOnOpen?: boolean }) => void
  closeTab: (id: string) => void
  closeTabsForConnection: (connectionId: string) => void
  setActiveTab: (id: string) => void
  setTabText: (id: string, text: string) => void
  loadQueryText: (id: string, text: string) => void
  startRun: (id: string, queryId: string) => void
  finishRun: (id: string, payload: { result: QueryResult } | { error: string }) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeConnectionId: null,
  connectionModal: null,
  tabs: [],
  activeTabId: null,
  _queryCounter: 0,

  setActiveConnection: (id) => set({ activeConnectionId: id }),
  openModal: (state) => set({ connectionModal: state }),
  closeModal: () => set({ connectionModal: null }),

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
      }
      return { tabs: [...s.tabs, tab], activeTabId: tab.id, _queryCounter: n }
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
      return { tabs: next, activeTabId }
    }),

  closeTabsForConnection: (connectionId) =>
    set((s) => {
      const next = s.tabs.filter((t) => t.connectionId !== connectionId)
      if (next.length === s.tabs.length) return s
      const stillActive = next.some((t) => t.id === s.activeTabId)
      return { tabs: next, activeTabId: stillActive ? s.activeTabId : (next[0]?.id ?? null) }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setTabText: (id, text) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, text } : t)),
    })),

  loadQueryText: (id, text) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, text, epoch: t.epoch + 1 } : t)),
    })),

  startRun: (id, queryId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, running: true, error: null, queryId, runOnOpen: false } : t
      ),
    })),

  finishRun: (id, payload) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t
        if ('result' in payload) return { ...t, running: false, queryId: null, result: payload.result, error: null }
        return { ...t, running: false, queryId: null, error: payload.error, result: null }
      }),
    })),
}))
