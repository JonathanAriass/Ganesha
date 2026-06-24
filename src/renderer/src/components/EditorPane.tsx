import { useAppStore } from '../state/store'
import { type PaneId } from '../lib/panes'
import TabBar from './TabBar'
import QueryTab from './QueryTab'
import DiagramView from './DiagramView'
import Welcome from './Welcome'

/** One editor group: its own tab strip + the pane's active tab content. Reused for both
 *  sides of a split. Clicking anywhere inside focuses the pane (so new tabs and the sidebar
 *  target it). The focus accent only shows while the view is actually split. */
export default function EditorPane({ paneId }: { paneId: PaneId }): JSX.Element {
  const focusedPane = useAppStore((s) => s.focusedPane)
  const tab = useAppStore((s) => {
    const id = s.activeTabByPane[paneId]
    return id ? s.tabs.find((t) => t.id === id) ?? null : null
  })
  const splitView = useAppStore((s) => s.tabs.some((t) => t.pane === 'right'))
  const focusPane = useAppStore((s) => s.focusPane)

  return (
    <div
      className={`editor-pane${splitView && paneId === focusedPane ? ' focused' : ''}`}
      onMouseDownCapture={() => focusPane(paneId)}
    >
      <TabBar pane={paneId} />
      {tab ? (
        tab.kind === 'diagram' ? (
          <DiagramView key={tab.id} connectionId={tab.connectionId} />
        ) : (
          <QueryTab key={tab.id} tab={tab} />
        )
      ) : (
        <Welcome />
      )}
    </div>
  )
}
