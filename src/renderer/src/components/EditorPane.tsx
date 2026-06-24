import { useState, type DragEvent } from 'react'
import { useAppStore } from '../state/store'
import { type PaneId } from '../lib/panes'
import { TAB_MIME } from '../lib/tab-reorder'
import TabBar from './TabBar'
import QueryTab from './QueryTab'
import DiagramView from './DiagramView'
import Welcome from './Welcome'

type DropSide = 'left' | 'right' | 'whole'

/** One editor group: its own tab strip + the pane's active tab content. Reused for both sides
 *  of a split. Clicking inside focuses the pane. While a tab is being dragged (`tabDragging`),
 *  the body shows a drop overlay: when not split it offers left/right zones that SPLIT (the
 *  dragged tab claims that side, the rest go opposite); when split it's one zone that MOVES the
 *  tab into this pane. The overlay covers the content so Monaco/the grid don't eat the drag. */
export default function EditorPane({ paneId }: { paneId: PaneId }): JSX.Element {
  const focusedPane = useAppStore((s) => s.focusedPane)
  const tab = useAppStore((s) => {
    const id = s.activeTabByPane[paneId]
    return id ? s.tabs.find((t) => t.id === id) ?? null : null
  })
  const splitView = useAppStore((s) => s.tabs.some((t) => t.pane === 'right'))
  const tabDragging = useAppStore((s) => s.tabDragging)
  const focusPane = useAppStore((s) => s.focusPane)
  const reorderTab = useAppStore((s) => s.reorderTab)
  const splitTabToSide = useAppStore((s) => s.splitTabToSide)
  const setTabDragging = useAppStore((s) => s.setTabDragging)

  const [dropSide, setDropSide] = useState<DropSide | null>(null)

  function onOverlayDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (splitView) {
      setDropSide('whole')
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    setDropSide(e.clientX < r.left + r.width / 2 ? 'left' : 'right')
  }

  function onOverlayDrop(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    const id = e.dataTransfer.getData(TAB_MIME)
    const side = dropSide
    setDropSide(null)
    setTabDragging(false) // the source's onDragEnd may not fire if a collapse unmounts it
    if (!id) return
    if (splitView) reorderTab({ tabId: id, toPane: paneId, beforeId: null })
    else if (side === 'left' || side === 'right') splitTabToSide({ tabId: id, side })
  }

  function onOverlayDragLeave(e: DragEvent<HTMLDivElement>): void {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropSide(null)
  }

  return (
    <div
      className={`editor-pane${splitView && paneId === focusedPane ? ' focused' : ''}`}
      onMouseDownCapture={() => focusPane(paneId)}
    >
      <TabBar pane={paneId} />
      <div className="editor-pane-body">
        {tab ? (
          tab.kind === 'diagram' ? (
            <DiagramView key={tab.id} connectionId={tab.connectionId} />
          ) : (
            <QueryTab key={tab.id} tab={tab} />
          )
        ) : (
          <Welcome />
        )}
        {tabDragging && (
          <div
            className="pane-drop-overlay"
            onDragOver={onOverlayDragOver}
            onDrop={onOverlayDrop}
            onDragLeave={onOverlayDragLeave}
          >
            {splitView ? (
              <div className={`drop-zone whole${dropSide === 'whole' ? ' active' : ''}`}>
                <span className="drop-zone-label">Move here</span>
              </div>
            ) : (
              <>
                <div className={`drop-zone${dropSide === 'left' ? ' active' : ''}`}>
                  <span className="drop-zone-label">Split left</span>
                </div>
                <div className={`drop-zone${dropSide === 'right' ? ' active' : ''}`}>
                  <span className="drop-zone-label">Split right</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
