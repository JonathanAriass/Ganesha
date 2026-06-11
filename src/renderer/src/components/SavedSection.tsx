import { useState } from 'react'
import { useAppStore } from '../state/store'
import { useSavedQueries, useDeleteSavedQuery } from '../lib/hooks'

export default function SavedSection(): JSX.Element | null {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openOrLoadQuery = useAppStore((s) => s.openOrLoadQuery)
  const openSaveQueryModal = useAppStore((s) => s.openSaveQueryModal)

  const { data: snippets, isLoading } = useSavedQueries(activeConnectionId)
  const del = useDeleteSavedQuery()
  // Two-step delete: × arms the row, the second click fires. Hover-out disarms.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  if (!activeConnectionId) return null

  return (
    <details className="history">
      <summary>Saved</summary>
      {!isLoading && snippets && snippets.length === 0 && (
        <div className="h-empty">Nothing saved yet — ☆ Save in the editor toolbar</div>
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
              onClick={() =>
                openOrLoadQuery({ connectionId: activeConnectionId, title: q.name, text: q.query })
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
              ✎
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
                ×
              </button>
            )}
          </div>
        ))}
    </details>
  )
}
