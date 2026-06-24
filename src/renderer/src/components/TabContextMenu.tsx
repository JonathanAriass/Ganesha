import { useEffect } from 'react'

export type TabCloseAction = 'close' | 'others' | 'right' | 'left' | 'all' | 'move-pane'

interface Props {
  x: number
  y: number
  /** Whether there are tabs to the right / left of the target (else the item is disabled). */
  canRight: boolean
  canLeft: boolean
  onSelect: (action: TabCloseAction) => void
  onClose: () => void
}

/** Right-click menu for a tab's close operations. A full-screen backdrop dismisses it on any
 *  outside mousedown (or a right-click elsewhere); Escape also closes it. */
export default function TabContextMenu({ x, y, canRight, canLeft, onSelect, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const item = (action: TabCloseAction, label: string, disabled = false): JSX.Element => (
    <button
      className="tab-menu-item"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect(action)
        onClose()
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="tab-menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        className="tab-menu"
        role="menu"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {item('move-pane', 'Move to other side')}
        <div className="tab-menu-sep" aria-hidden="true" />
        {item('close', 'Close')}
        {item('others', 'Close others')}
        {item('right', 'Close to the right', !canRight)}
        {item('left', 'Close to the left', !canLeft)}
        {item('all', 'Close all')}
      </div>
    </div>
  )
}
