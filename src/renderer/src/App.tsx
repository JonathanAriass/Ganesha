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
import HistorySection from './components/HistorySection'
import { useSettings } from './lib/hooks'
import { applyTheme } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
})

function AppShell(): JSX.Element {
  const connectionModal = useAppStore((s) => s.connectionModal)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const paletteOpen = useAppStore((s) => s.paletteOpen)
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
