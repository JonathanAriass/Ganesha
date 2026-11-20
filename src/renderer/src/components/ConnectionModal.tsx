import { useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import type { ConnectionInput, ConnectionType, SshConfig } from '@shared/domain'
import { useAppStore } from '../state/store'
import {
  useConnections,
  useSaveConnection,
  useConnectionActions,
  useTestConnection,
} from '../lib/hooks'
import SshHopEditor from './SshHopEditor'
import { emptyHop, validateSshConfig } from '../lib/ssh-config'
import { unwrap } from '../lib/result'
import { ENVIRONMENT_MAX_LENGTH, ENVIRONMENT_SUGGESTIONS } from '@shared/environment'
import { ENGINES, portAfterEngineChange, connectionFormProblem } from '../lib/connection-form'
import { Icon } from './icons'

// ── Constants ────────────────────────────────────────────────────────────────

const COLOR_SWATCHES = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#8b5cf6', // violet
]

const DEFAULT_INPUT: ConnectionInput = {
  type: 'postgres',
  name: '',
  color: '#6366f1',
  host: 'localhost',
  port: 5432,
  username: '',
  database: '',
  ssl: false,
  readOnly: false,
  requireCommit: true,
  authSource: '',
  replicaSet: '',
  ssh: null,
  repoPath: null,
  environment: '',
}

// ── Test status ──────────────────────────────────────────────────────────────

/** The form is split in three: what every connection needs, the SSH tunnel, and the rest. */
type ConnTab = 'general' | 'ssh' | 'options'
const TABS: { id: ConnTab; label: string }[] = [
  { id: 'general', label: 'Connection' },
  { id: 'ssh', label: 'SSH tunnel' },
  { id: 'options', label: 'Options' },
]

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok' }
  | { kind: 'err'; message: string }

// ── Component ────────────────────────────────────────────────────────────────

export default function ConnectionModal(): JSX.Element {
  const modal = useAppStore((s) => s.connectionModal)
  const closeModal = useAppStore((s) => s.closeModal)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)

  const isEdit = modal?.mode === 'edit'
  const editId = isEdit ? (modal as { mode: 'edit'; id: string }).id : undefined

  const { data: connections = [] } = useConnections()
  const existingConn = editId ? connections.find((c) => c.id === editId) : undefined

  const [form, setForm] = useState<ConnectionInput>(DEFAULT_INPUT)
  const [password, setPassword] = useState<string>('')
  // SSH passphrases/passwords by hop id — write-only, blank = keep current on edit.
  const [sshSecrets, setSshSecrets] = useState<Record<string, string>>({})
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [tab, setTab] = useState<ConnTab>('general')

  // Initialize form from existing connection on edit
  useEffect(() => {
    if (isEdit && existingConn) {
      setForm({
        type: existingConn.type,
        name: existingConn.name,
        color: existingConn.color,
        host: existingConn.host,
        port: existingConn.port,
        username: existingConn.username,
        database: existingConn.database,
        ssl: existingConn.ssl,
        readOnly: existingConn.readOnly,
        requireCommit: existingConn.requireCommit,
        authSource: existingConn.authSource,
        replicaSet: existingConn.replicaSet,
        ssh: existingConn.ssh,
        repoPath: existingConn.repoPath,
        environment: existingConn.environment,
      })
      setPassword('') // blank = keep current on edit
    } else if (!isEdit) {
      setForm(DEFAULT_INPUT)
      setPassword('')
    }
    setSshSecrets({}) // typed-this-session only; never preload stored secrets
    setShowPassword(false)
    setTab('general')
    setTestStatus({ kind: 'idle' })
    setSaveError(null)
  }, [isEdit, existingConn])

  const save = useSaveConnection()
  const actions = useConnectionActions()
  const test = useTestConnection()

  // Any edit makes the last test result stale: a "Connection OK" must describe what is on
  // screen. (A test still running keeps its spinner; its answer is for the values it was sent.)
  function touched(): void {
    setSaveError(null)
    setTestStatus((t) => (t.kind === 'pending' ? t : { kind: 'idle' }))
  }

  function setField<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    touched()
  }

  function handleTypeChange(newType: ConnectionType) {
    setForm((prev) => ({ ...prev, type: newType, port: portAfterEngineChange(prev.type, newType, prev.port) }))
    touched()
  }

  function setSshEnabled(enabled: boolean) {
    const cur: SshConfig = form.ssh ?? { enabled: false, hops: [] }
    // Enabling with no hops yet seeds one so the editor isn't empty.
    const hops = enabled && cur.hops.length === 0 ? [emptyHop(crypto.randomUUID())] : cur.hops
    setField('ssh', { enabled, hops })
  }

  async function pickRepo() {
    const dir = unwrap(await window.api.dialog.pickDirectory())
    if (dir) setField('repoPath', dir)
  }

  function handleTest() {
    const sshErr = validateSshConfig(form.ssh)
    if (sshErr) { setTab('ssh'); setTestStatus({ kind: 'err', message: sshErr }); return }
    setTestStatus({ kind: 'pending' })
    // Blank password on edit means "keep current" — send the id so main can
    // test with the stored secret (it never comes back to the renderer).
    const pwd = password || null
    test.mutate(
      { input: form, password: pwd, id: editId, sshSecrets },
      {
        onSuccess: () => setTestStatus({ kind: 'ok' }),
        onError: (e) =>
          setTestStatus({
            kind: 'err',
            message: e instanceof Error ? e.message : String(e),
          }),
      },
    )
  }

  const handleSave = useCallback(() => {
    setSaveError(null)
    const sshErr = validateSshConfig(form.ssh)
    if (sshErr) { setTab('ssh'); setSaveError(sshErr); return }
    // password semantics:
    //   create → pass password || null
    //   edit   → blank string becomes undefined (keep), non-blank becomes value
    const pwd = editId
      ? password === ''
        ? undefined
        : password
      : password || null

    save.mutate(
      { id: editId, input: form, password: pwd, sshSecrets },
      {
        onSuccess: (saved) => {
          setActiveConnection(saved.id)
          closeModal()
        },
        onError: (e) =>
          setSaveError(e instanceof Error ? e.message : String(e)),
      },
    )
  }, [editId, form, password, sshSecrets, save, setActiveConnection, closeModal])

  // A failed delete shows in the modal's own error line, like a failed duplicate.
  function handleDelete() {
    if (!editId) return
    setSaveError(null)
    actions.remove({ id: editId, name: form.name }, { onSuccess: closeModal, onError: setSaveError })
  }

  // The hook reopens the editor on the copy; a failure shows in the modal's own error line.
  function handleDuplicate() {
    if (!editId) return
    setSaveError(null)
    actions.duplicate(editId, { onError: setSaveError })
  }

  const problem = connectionFormProblem(form)
  const canSave = problem === null
  const isMongo = form.type === 'mongodb'
  const testing = testStatus.kind === 'pending'
  // What a tab holds while it is not the one showing, so nothing set there goes unseen.
  const optionsOn = [form.ssl && 'SSL', form.readOnly && 'Read-only', form.repoPath && 'Repo'].filter(Boolean).join(' · ')
  const tabNote: Record<ConnTab, string> = { general: '', ssh: form.ssh?.enabled ? 'On' : '', options: optionsOn }

  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id
    setTab(next)
    document.getElementById(`conn-tab-${next}`)?.focus()
  }

  // Enter in any field saves, like the button.
  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    if (canSave && !save.isPending) handleSave()
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit connection' : 'New connection'}
      // mousedown, not click: after a drag out of an input, the click retargets
      // to the overlay (common ancestor) and would dismiss the half-filled form.
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal() }}
    >
      <form className="modal conn-modal" onSubmit={onSubmit} noValidate>
        <div className="modal-header">
          <span className="conn-dot" style={{ background: form.color }} aria-hidden="true" />
          <h2>{isEdit ? 'Edit connection' : 'New connection'}</h2>
          <button type="button" className="btn ghost xs modal-close" onClick={closeModal} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="conn-tabs" role="tablist" aria-label="Connection settings" onKeyDown={onTabKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`conn-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`conn-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`conn-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {tabNote[t.id] && <span className="conn-tab-note">{tabNote[t.id]}</span>}
            </button>
          ))}
        </div>

        <div className="modal-body">
         <div className="conn-tabpanel" role="tabpanel" id="conn-panel-general" aria-labelledby="conn-tab-general" hidden={tab !== 'general'}>
          {/* Engine first: it decides the default port and which fields exist. */}
          <div className="conn-seg" role="radiogroup" aria-label="Database engine">
            {ENGINES.map((e) => (
              <button
                key={e.type}
                type="button"
                role="radio"
                aria-checked={form.type === e.type}
                className={`conn-seg-opt${form.type === e.type ? ' active' : ''}`}
                onClick={() => handleTypeChange(e.type)}
              >
                {e.label}
              </button>
            ))}
          </div>

          <section className="conn-section" aria-label="Identity">
            <div className="form-row">
              <label htmlFor="conn-name">Name</label>
              <input
                id="conn-name"
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="How you want to see it in the sidebar"
                autoFocus
              />
            </div>
            <div className="conn-row-split">
              <div className="form-row">
                <label>Color</label>
                <div className="color-swatches" role="radiogroup" aria-label="Connection color">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={form.color === c}
                      className={`swatch${form.color === c ? ' selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => setField('color', c)}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="conn-environment">
                  Environment <span className="hint">optional tag, e.g. PROD</span>
                </label>
                <input
                  id="conn-environment"
                  type="text"
                  list="conn-environment-options"
                  maxLength={ENVIRONMENT_MAX_LENGTH}
                  value={form.environment}
                  onChange={(e) => setField('environment', e.target.value)}
                  placeholder="PROD"
                />
                <datalist id="conn-environment-options">
                  {ENVIRONMENT_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
            </div>
          </section>

          <section className="conn-section" aria-labelledby="conn-sec-server">
            <h3 id="conn-sec-server" className="conn-section-title">Server</h3>
            <div className="conn-row-host">
              <div className="form-row">
                <label htmlFor="conn-host">Host</label>
                <input
                  id="conn-host"
                  type="text"
                  value={form.host}
                  onChange={(e) => setField('host', e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div className="form-row">
                <label htmlFor="conn-port">Port</label>
                <input
                  id="conn-port"
                  type="number"
                  value={Number.isFinite(form.port) && form.port !== 0 ? form.port : ''}
                  min={1}
                  max={65535}
                  onChange={(e) => setField('port', Number(e.target.value))}
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="conn-db">
                Database {isMongo && <span className="hint">blank = browse all databases</span>}
              </label>
              <input
                id="conn-db"
                type="text"
                value={form.database}
                onChange={(e) => setField('database', e.target.value)}
              />
            </div>
            {isMongo && (
              <div className="form-row-2">
                <div className="form-row">
                  <label htmlFor="conn-authsource">Auth source</label>
                  <input
                    id="conn-authsource"
                    type="text"
                    value={form.authSource}
                    onChange={(e) => setField('authSource', e.target.value)}
                    placeholder="admin"
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="conn-replicaset">Replica set</label>
                  <input
                    id="conn-replicaset"
                    type="text"
                    value={form.replicaSet}
                    onChange={(e) => setField('replicaSet', e.target.value)}
                    placeholder="rs0"
                  />
                </div>
              </div>
            )}
            <div className="form-row-2">
              <div className="form-row">
                <label htmlFor="conn-user">Username</label>
                <input
                  id="conn-user"
                  type="text"
                  autoComplete="off"
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="conn-password">Password</label>
                <div className="conn-secret">
                  <input
                    id="conn-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="off"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); touched() }}
                    placeholder={isEdit ? 'Unchanged' : ''}
                  />
                  <button
                    type="button"
                    className="conn-secret-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    disabled={password === ''}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>
            {isEdit && <p className="form-hint">Leave the password empty to keep the one already saved.</p>}
          </section>

         </div>

         <div className="conn-tabpanel" role="tabpanel" id="conn-panel-options" aria-labelledby="conn-tab-options" hidden={tab !== 'options'}>
          <section className="conn-section" aria-labelledby="conn-sec-safety">
            <h3 id="conn-sec-safety" className="conn-section-title">Security and safety</h3>
            <label className="conn-toggle">
              <input type="checkbox" checked={form.ssl} onChange={(e) => setField('ssl', e.target.checked)} />
              <span>
                <span className="conn-toggle-name">SSL/TLS</span>
                <span className="conn-toggle-hint">Encrypt the connection to the server.</span>
              </span>
            </label>
            <label className="conn-toggle">
              <input type="checkbox" checked={form.readOnly} onChange={(e) => setField('readOnly', e.target.checked)} />
              <span>
                <span className="conn-toggle-name">Read-only</span>
                <span className="conn-toggle-hint">Block anything that writes: no edits, no data-changing statements.</span>
              </span>
            </label>
            <label className={`conn-toggle${form.readOnly ? ' disabled' : ''}`}>
              <input
                type="checkbox"
                checked={form.requireCommit}
                disabled={form.readOnly}
                onChange={(e) => setField('requireCommit', e.target.checked)}
              />
              <span>
                <span className="conn-toggle-name">Stage cell edits until I commit</span>
                <span className="conn-toggle-hint">
                  {form.readOnly
                    ? 'Not applicable: a read-only connection has no edits.'
                    : 'Edits in the results grid wait for an explicit Commit instead of writing at once.'}
                </span>
              </span>
            </label>
          </section>

          {/* Linked repo — gives the assistant code context (ORM models, migrations) */}
          <section className="conn-section" aria-labelledby="conn-sec-repo">
            <h3 id="conn-sec-repo" className="conn-section-title">Assistant</h3>
            <div className="form-row">
              <label htmlFor="conn-repo">
                Linked repo <span className="hint">the assistant reads it for query context</span>
              </label>
              <div className="repo-path-row">
                <input
                  id="conn-repo"
                  type="text"
                  value={form.repoPath ?? ''}
                  onChange={(e) => setField('repoPath', e.target.value || null)}
                  placeholder="/path/to/your/backend"
                />
                <button type="button" className="btn ghost" onClick={pickRepo}>Browse…</button>
                {form.repoPath && (
                  <button type="button" className="btn ghost" onClick={() => setField('repoPath', null)} aria-label="Clear linked repo">✕</button>
                )}
              </div>
            </div>
          </section>
         </div>

         <div className="conn-tabpanel" role="tabpanel" id="conn-panel-ssh" aria-labelledby="conn-tab-ssh" hidden={tab !== 'ssh'}>
          <section className="conn-section" aria-labelledby="conn-sec-ssh">
            <label className="conn-toggle">
              <input type="checkbox" checked={!!form.ssh?.enabled} onChange={(e) => setSshEnabled(e.target.checked)} />
              <span>
                <span id="conn-sec-ssh" className="conn-toggle-name">Connect through an SSH tunnel</span>
                <span className="conn-toggle-hint">For servers only reachable from a bastion or jump host.</span>
              </span>
            </label>
            {form.ssh?.enabled && (
              <SshHopEditor
                ssh={form.ssh}
                secrets={sshSecrets}
                isEdit={isEdit}
                onChange={(ssh) => setField('ssh', ssh)}
                onSecretChange={(hopId, value) => { setSshSecrets((prev) => ({ ...prev, [hopId]: value })); touched() }}
              />
            )}
          </section>
         </div>

        </div>

        {/* Outcome of Test and Save: always in view, right above the buttons. */}
        <div className="conn-feedback" aria-live="polite">
          {testing && <div className="status" role="status">Testing the connection…</div>}
          {testStatus.kind === 'ok' && <div className="status ok" role="status">✓ Connection OK</div>}
          {testStatus.kind === 'err' && (
            <div className="status err" role="alert">
              <strong>Could not connect.</strong> {testStatus.message}
            </div>
          )}
          {saveError && <div className="status err" role="alert">{saveError}</div>}
        </div>

        <div className="modal-footer">
          {isEdit && (
            <button type="button" className="btn ghost conn-danger" onClick={handleDelete} disabled={actions.removing}>
              {actions.removing ? 'Deleting…' : 'Delete'}
            </button>
          )}
          {isEdit && (
            <button
              type="button"
              className="btn ghost"
              onClick={handleDuplicate}
              disabled={actions.duplicating}
              title="Create a copy of this connection (keeps the password) and edit it"
            >
              {actions.duplicating ? 'Duplicating…' : 'Duplicate'}
            </button>
          )}

          <span className="spacer" />
          {problem && <span className="conn-problem">{problem}</span>}

          <button
            type="button"
            className="btn"
            onClick={handleTest}
            disabled={testing || !canSave}
            aria-label="Test connection"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="btn ghost" onClick={closeModal}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!canSave || save.isPending}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create connection'}
          </button>
        </div>
      </form>
    </div>
  )
}
