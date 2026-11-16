import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MIN_PASSPHRASE_LENGTH } from '@shared/transfer'
import { unwrap } from '../lib/result'
import { useRestoreFocus } from '../lib/use-restore-focus'
import type { TransferModalState } from '../lib/transfer-actions'


const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Export / import connections dialog. Rendered only while open (the dashboard gates it),
 *  so its state resets per open. Passwords never reach this component: export sends ids
 *  + a passphrase to the main process, which reads, encrypts and writes the file itself. */
export default function ConnectionTransferModal({ state, onClose }: { state: TransferModalState; onClose: () => void }): JSX.Element {
  const qc = useQueryClient()
  const isExport = state.mode === 'export'
  const fileHasSecrets = state.mode === 'import' && state.preview.hasSecrets

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(state.mode === 'export' ? state.connections.map((c) => c.id) : [])
  )
  const [withSecrets, setWithSecrets] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useRestoreFocus()

  const passTooShort = passphrase.length < MIN_PASSPHRASE_LENGTH
  const exportBlocked = selected.size === 0 || (withSecrets && (passTooShort || passphrase !== confirm))
  const canSubmit = !busy && (isExport ? !exportBlocked : true)

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (state.mode === 'export') {
        const all = selected.size === state.connections.length
        const res = unwrap(await window.api.connections.export(all ? null : [...selected], withSecrets ? passphrase : null))
        if (res) {
          setDone(
            `Exported ${plural(res.connections, 'connection')} ${res.withSecrets ? 'with encrypted passwords' : 'without passwords'} to ${res.path}`
          )
        }
      } else {
        const res = unwrap(await window.api.connections.import(fileHasSecrets && passphrase !== '' ? passphrase : null))
        void qc.invalidateQueries({ queryKey: ['connections'] })
        void qc.invalidateQueries({ queryKey: ['groups'] })
        const parts = [`Imported ${plural(res.imported, 'connection')}`]
        if (res.skipped > 0) parts.push(`skipped ${res.skipped} already here`)
        if (res.groupsCreated > 0) parts.push(`created ${plural(res.groupsCreated, 'group')}`)
        const tail = res.imported === 0 || res.withSecrets ? '' : ' Passwords were not imported — edit each connection to set one.'
        setDone(`${parts.join(', ')}.${tail}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const title = isExport ? 'Export connections' : 'Import connections'

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <form onSubmit={(e) => void submit(e)}>
          <div className="modal-header">
            <h2>{title}</h2>
          </div>
          <div className="modal-body">
            {done ? (
              <div className="status ok" role="status">
                {done}
              </div>
            ) : (
              <div className="form-grid">
                {state.mode === 'export' ? (
                  <>
                    <div className="form-row">
                      <label>Connections ({selected.size} of {state.connections.length})</label>
                      <div className="transfer-list">
                        {state.connections.map((c) => (
                          <label key={c.id} className="checkbox-row">
                            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                            <span className="transfer-name">{c.name}</span>
                            <span className="hint">
                              {c.type} · {c.host}:{c.port}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="form-hint">Groups and subgroups are exported with their connections.</p>
                    </div>
                    <div className="form-row">
                      <label className="checkbox-row">
                        <input type="checkbox" checked={withSecrets} onChange={(e) => setWithSecrets(e.target.checked)} />
                        Include passwords and SSH secrets
                      </label>
                      <p className="form-hint">
                        {withSecrets
                          ? 'They are encrypted with the passphrase below. Anyone with the file and the passphrase can read them — share the passphrase separately.'
                          : 'Off: the file contains no secrets. Whoever imports it sets their own passwords.'}
                      </p>
                    </div>
                    {withSecrets && (
                      <>
                        <div className="form-row">
                          <label htmlFor="xfer-pass">Passphrase</label>
                          <input id="xfer-pass" type="password" autoFocus value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                          {passphrase !== '' && passTooShort && (
                            <p className="form-hint">At least {MIN_PASSPHRASE_LENGTH} characters.</p>
                          )}
                        </div>
                        <div className="form-row">
                          <label htmlFor="xfer-confirm">Repeat passphrase</label>
                          <input id="xfer-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                          {confirm !== '' && confirm !== passphrase && <p className="form-hint">Passphrases don’t match.</p>}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p className="form-hint">
                      <strong>{state.preview.fileName}</strong> — {plural(state.preview.connections, 'connection')}
                      {state.preview.groups > 0 ? `, ${plural(state.preview.groups, 'group')}` : ''}. They are added to your
                      dashboard; nothing you already have is changed, and connections you already have are skipped.
                    </p>
                    {fileHasSecrets ? (
                      <div className="form-row">
                        <label htmlFor="xfer-pass">Passphrase</label>
                        <input id="xfer-pass" type="password" autoFocus value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                        <p className="form-hint">
                          This file includes encrypted passwords. Leave blank to import the connections without them.
                        </p>
                      </div>
                    ) : (
                      <p className="form-hint">This file has no passwords — set them by editing each connection after importing.</p>
                    )}
                  </>
                )}
                {error && (
                  <div className="status err" role="alert">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <span className="spacer" />
            {done ? (
              <button type="button" className="btn primary" autoFocus onClick={onClose}>
                Done
              </button>
            ) : (
              <>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={!canSubmit}>
                  {busy ? (isExport ? 'Exporting…' : 'Importing…') : isExport ? 'Export…' : 'Import'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
