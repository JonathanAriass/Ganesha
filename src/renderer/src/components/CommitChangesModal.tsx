import { useAppStore } from '../state/store'
import { describeEdits, type EditChange } from '../lib/edit-staging'
import { cellText } from '../lib/grid-text'
import { useRestoreFocus } from '../lib/use-restore-focus'

/** Confirmation review for staged results-grid edits before they're written. Opened by
 *  ⌘S / the Commit button when the connection requires an explicit commit; lists every
 *  pending change so the user can confirm (or cancel) the database write. */
export default function CommitChangesModal(): JSX.Element | null {
  const modal = useAppStore((s) => s.commitModal)
  const close = useAppStore((s) => s.closeCommitModal)
  const commitEdits = useAppStore((s) => s.commitEdits)
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === modal?.tabId))

  useRestoreFocus()

  if (!modal || !tab) return null
  const result = tab.result
  const changes: EditChange[] =
    result?.editable ? describeEdits(tab.edits, result.columns, result.rows, result.editable) : []

  // Nothing left to confirm (e.g. all reset) — drop the modal.
  if (changes.length === 0) {
    close()
    return null
  }

  const tableName = changes[0].table
  const confirm = async (): Promise<void> => {
    await commitEdits(tab.id)
    // commitEdits clears edits on success, or keeps them + sets editError on failure.
    const after = useAppStore.getState().tabs.find((t) => t.id === tab.id)
    if (!after || Object.keys(after.edits).length === 0) close() // success → dismiss
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal commit-modal" role="dialog" aria-modal="true" aria-label="Confirm changes">
        <div className="modal-header">
          <h2>
            Commit {changes.length} change{changes.length === 1 ? '' : 's'} to {tableName}?
          </h2>
        </div>
        <div className="modal-body">
          <table className="commit-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Column</th>
                <th>From</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i}>
                  <td className="commit-key">
                    {Object.entries(c.key)
                      .map(([k, v]) => `${k}=${cellText(v)}`)
                      .join(', ')}
                  </td>
                  <td>{c.column}</td>
                  <td className="commit-old">{c.oldValue === null || c.oldValue === undefined ? 'NULL' : cellText(c.oldValue)}</td>
                  <td className="commit-new">{c.newValue === null || c.newValue === undefined ? 'NULL' : cellText(c.newValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tab.editError && (
            <div className="status err" role="alert">
              {tab.editError}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button type="button" className="btn" onClick={close} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void confirm()}>
            Commit {changes.length} change{changes.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
