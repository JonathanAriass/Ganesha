import { useState } from 'react'
import { useAppStore } from '../state/store'
import { useSavedQueries, useDeleteSavedQuery } from '../lib/hooks'
import { Icon } from './icons'

export default function SavedSection(): JSX.Element | null {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const openSaveQueryModal = useAppStore((s) => s.openSaveQueryModal)

  const { data: snippets, isLoading, isError } = useSavedQueries(activeConnectionId)
  const del = useDeleteSavedQuery()
  // Two-step delete: the close button arms the row, the second click fires. Hover-out disarms.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  if (!activeConnectionId) return null

  return (
    <div className="panel-section">
      {isError && <div className="h-empty">Couldn’t load saved queries</div>}
      {del.isError && (
        <div className="h-empty" role="alert">
          Delete failed — {del.error instanceof Error ? del.error.message : String(del.error)}
        </div>
      )}
      {!isLoading && snippets && snippets.length === 0 && (
        <div className="h-empty">
          Nothing saved yet — <Icon name="star" size={12} /> Save in the bar above the editor
        </div>
      )}
      {snippets &&
        snippets.map((q) => (
          <div
            key={q.id}
            className="saved-item"
            onMouseLeave={() => setConfirmingId((c) => (c === q.id ? null : c))}
          >
            <button
              className="s-open"
              title={q.query}
              // Clicking a saved query opens a fresh tab and runs it (runOnOpen) — never
              // clobbers the current tab's draft.
              onClick={() =>
                openQueryTab({
                  connectionId: activeConnectionId,
                  title: q.name,
                  text: q.query,
                  runOnOpen: true,
                })
              }
            >
              <span className="s-name">{q.name}</span>
            </button>
            <button
              className="s-act"
              aria-label={`Rename ${q.name}`}
              title="Rename"
              onClick={() => openSaveQueryModal({ mode: 'rename', id: q.id, name: q.name })}
            >
              <Icon name="pencil" size={12} />
            </button>
            {confirmingId === q.id ? (
              <button
                className="s-act danger"
                aria-label={`Confirm delete ${q.name}`}
                onClick={() => {
                  del.mutate(q.id)
                  setConfirmingId(null)
                }}
              >
                Delete?
              </button>
            ) : (
              <button
                className="s-act"
                aria-label={`Delete ${q.name}`}
                title="Delete"
                onClick={() => setConfirmingId(q.id)}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        ))}
    </div>
  )
}
