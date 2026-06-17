import { useRef, useState } from 'react'
import { cellText } from '../lib/grid-text'

/** An inline value editor (a text input + a NULL control), shared by the results grid and
 *  the document tree. Commits exactly once (Enter, blur, or NULL) — the `done` guard stops
 *  the Enter→unmount→blur path firing twice. Seeds from `cellText` so an object/jsonb/array
 *  value opens as its JSON text, not `[object Object]`. */
export default function EditingCell({
  initial,
  onCommit,
  onCancel,
  className = 'grid-cell editing',
}: {
  initial: unknown
  onCommit: (value: unknown) => void
  onCancel: () => void
  className?: string
}): JSX.Element {
  const [text, setText] = useState(initial === null || initial === undefined ? '' : cellText(initial))
  const done = useRef(false)
  const commit = (value: unknown): void => {
    if (done.current) return
    done.current = true
    onCommit(value)
  }
  return (
    <span className={className} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
          else if (e.key === 'Escape') {
            done.current = true // suppress the blur-commit that the unmount triggers
            onCancel()
          }
        }}
        onBlur={() => commit(text)}
      />
      <button
        className="cell-null-btn"
        title="Set NULL"
        // mousedown + preventDefault keeps the input focused so its blur doesn't beat us.
        onMouseDown={(e) => {
          e.preventDefault()
          commit(null)
        }}
      >
        ∅
      </button>
    </span>
  )
}
