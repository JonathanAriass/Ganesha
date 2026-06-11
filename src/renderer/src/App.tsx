import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from './state/store'
import TopBar from './components/TopBar'
import Welcome from './components/Welcome'
import ObjectTree from './components/ObjectTree'
import ConnectionModal from './components/ConnectionModal'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import TabBar from './components/TabBar'
import QueryTab from './components/QueryTab'
import SavedSection from './components/SavedSection'
import HistorySection from './components/HistorySection'
import SaveQueryModal from './components/SaveQueryModal'
import { useSettings } from './lib/hooks'
import { applyTheme } from './lib/theme'
import { useGlobalShortcuts } from './lib/use-global-shortcuts'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
})

function AppShell(): JSX.Element {
  useGlobalShortcuts()
  const connectionModal = useAppStore((s) => s.connectionModal)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const paletteOpen = useAppStore((s) => s.paletteOpen)
  const saveQueryModal = useAppStore((s) => s.saveQueryModal)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)

  const { data: settings } = useSettings()
  useEffect(() => {
    if (settings) applyTheme(settings.theme)
  }, [settings])

  const activeTab = tabs.find((t) => t.id === activeTabId)

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
          {tabs.length > 0 ? (
            <>
              <TabBar />
              {activeTab ? (
                <QueryTab key={activeTabId} tab={activeTab} />
              ) : (
                <Welcome />
              )}
            </>
          ) : (
            <Welcome />
          )}
        </main>
      </div>
      {connectionModal && <ConnectionModal />}
      {settingsOpen && <SettingsModal />}
      {paletteOpen && <CommandPalette />}
      {saveQueryModal && <SaveQueryModal />}
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
