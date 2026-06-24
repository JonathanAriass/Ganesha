import { useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import type { SsmTunnel } from '@shared/domain'
import { useAppStore } from './state/store'
import TopBar from './components/TopBar'
import Welcome from './components/Welcome'
import ObjectTree from './components/ObjectTree'
import ConnectionModal from './components/ConnectionModal'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import EditorPane from './components/EditorPane'
import PaneDivider from './components/PaneDivider'
import { loadPaneFraction } from './lib/pane-split'
import SsmPanel from './components/SsmPanel'
import SavedSection from './components/SavedSection'
import HistorySection from './components/HistorySection'
import SaveQueryModal from './components/SaveQueryModal'
import CommitChangesModal from './components/CommitChangesModal'
import AssistantPanel from './components/AssistantPanel'
import ModelManagerModal from './components/ModelManagerModal'
import { useSettings } from './lib/hooks'
import { applyTheme } from './lib/theme'
import { useGlobalShortcuts } from './lib/use-global-shortcuts'
import { useSessionPersistence } from './lib/use-session-persistence'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
})

function AppShell(): JSX.Element {
  useGlobalShortcuts()
  useSessionPersistence()
  const connectionModal = useAppStore((s) => s.connectionModal)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const paletteOpen = useAppStore((s) => s.paletteOpen)
  const saveQueryModal = useAppStore((s) => s.saveQueryModal)
  const commitModal = useAppStore((s) => s.commitModal)
  const tabs = useAppStore((s) => s.tabs)
  const splitView = useAppStore((s) => s.tabs.some((t) => t.pane === 'right'))
  const leftPaneRef = useRef<HTMLDivElement>(null)
  // Pin to first render: avoids re-reading localStorage on every render and a mid-drag flicker if
  // the tree re-renders while the divider is being dragged (PaneDivider writes flex-basis directly).
  const [initialLeftFraction] = useState(() => loadPaneFraction())

  const { data: settings } = useSettings()
  useEffect(() => {
    if (settings) applyTheme(settings.theme)
  }, [settings])

  // Keep the running-SSM-tunnel set live for the panel + the connect-time banner.
  const setSsmRunning = useAppStore((s) => s.setSsmRunning)
  const markSsm = useAppStore((s) => s.markSsm)
  const qc = useQueryClient()
  useEffect(() => {
    window.api.ssm.running().then((r) => { if (r.ok) setSsmRunning(r.data) })
    return window.api.ssm.onStatus((e) => {
      markSsm(e.id, e.running)
      // The tunnel is now accepting connections → if a DB connection is linked to it, refresh its
      // schema (table list + autocomplete + diagram) so it appears without a manual reconnect. The
      // local port is fixed, so the existing pool just re-dials the now-open forward.
      if (!e.ready) return
      const connId = qc.getQueryData<SsmTunnel[]>(['ssm'])?.find((t) => t.id === e.id)?.connectionId
      if (connId) {
        for (const k of ['objects', 'columns', 'databases', 'allColumns', 'relationships']) {
          void qc.invalidateQueries({ queryKey: [k, connId] })
        }
      }
    })
  }, [setSsmRunning, markSsm, qc])

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <aside className="sidebar">
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            <ObjectTree />
          </div>
          <SavedSection />
          <HistorySection />
        </aside>
        <main className="main">
          {tabs.length === 0 ? (
            <Welcome />
          ) : splitView ? (
            <div className="panes">
              <div className="pane-slot" ref={leftPaneRef} style={{ flexBasis: `${initialLeftFraction * 100}%` }}>
                <EditorPane paneId="left" />
              </div>
              <PaneDivider leftPaneRef={leftPaneRef} />
              <div className="pane-slot pane-slot-right">
                <EditorPane paneId="right" />
              </div>
            </div>
          ) : (
            <EditorPane paneId="left" />
          )}
        </main>
        <AssistantPanel />
        <SsmPanel />
      </div>
      {connectionModal && <ConnectionModal />}
      {settingsOpen && <SettingsModal />}
      {paletteOpen && <CommandPalette />}
      {saveQueryModal && <SaveQueryModal />}
      {commitModal && <CommitChangesModal />}
      <ModelManagerModal />
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}
