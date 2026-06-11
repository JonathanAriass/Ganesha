import { useState, type FormEvent } from 'react'
import { useAppStore } from '../state/store'
import { useConnections, useCreateSavedQuery, useUpdateSavedQuery } from '../lib/hooks'
import { defaultSnippetName } from '../lib/snippet-name'
import { useRestoreFocus } from '../lib/use-restore-focus'

/** Name dialog for saving/renaming a query. Rendered only while open (parent
 *  gates on store.saveQueryModal), so the name initializer runs per open. */
export default function SaveQueryModal(): JSX.Element | null {
  const modal = useAppStore((s) => s.saveQueryModal)
  const close = useAppStore((s) => s.closeSaveQueryModal)
  const create = useCreateSavedQuery()
  const update = useUpdateSavedQuery()
  const { data: connections = [] } = useConnections()
  const [name, setName] = useState(() =>
    modal === null ? '' : modal.mode === 'rename' ? modal.name : defaultSnippetName(modal.query)
  )

  useRestoreFocus()

  if (!modal) return null

  const conn =
    modal.mode === 'create' ? connections.find((c) => c.id === modal.connectionId) : undefined
  const mutation = modal.mode === 'create' ? create : update
  const canSave = name.trim().length > 0 && !mutation.isPending

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!canSave) return
    const trimmed = name.trim()
    if (modal.mode === 'create') {
      create.mutate(
        { connectionId: modal.connectionId, name: trimmed, query: modal.query },
        { onSuccess: close }
      )
    } else {
      update.mutate({ id: modal.id, patch: { name: trimmed } }, { onSuccess: close })
    }
  }

  return (
    // mousedown + target guard, not click: a drag-select that starts in the name
    // input and releases over the backdrop must not throw the form away.
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={modal.mode === 'create' ? 'Save query' : 'Rename saved query'}
      >
        <form onSubmit={submit}>
          <div className="modal-header">
            <h2>{modal.mode === 'create' ? 'Save query' : 'Rename saved query'}</h2>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="sq-name">Name</label>
                <input
                  id="sq-name"
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Top customers"
                />
                {conn && (
                  <p className="form-hint">
                    Saves to “{conn.name}” — snippets are per-connection.
                  </p>
                )}
              </div>
              {mutation.isError && (
                <div className="status err" role="alert">
                  {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <span className="spacer" />
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!canSave}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
