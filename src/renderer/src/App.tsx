import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from './state/store'
import TopBar from './components/TopBar'
import Welcome from './components/Welcome'
import ObjectTree from './components/ObjectTree'
import ConnectionModal from './components/ConnectionModal'
import TabBar from './components/TabBar'
import QueryTab from './components/QueryTab'
import HistorySection from './components/HistorySection'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
})

function AppShell(): JSX.Element {
  const connectionModal = useAppStore((s) => s.connectionModal)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)

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
