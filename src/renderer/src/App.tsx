import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from './state/store'
import TopBar from './components/TopBar'
import Welcome from './components/Welcome'
import ObjectTree from './components/ObjectTree'
import ConnectionModal from './components/ConnectionModal'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
})

function AppShell(): JSX.Element {
  const connectionModal = useAppStore((s) => s.connectionModal)

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <aside className="sidebar">
          <ObjectTree />
        </aside>
        <main className="main">
          <Welcome />
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
