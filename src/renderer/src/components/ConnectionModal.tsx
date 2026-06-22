import React, { useState, useEffect, useCallback } from 'react'
import type { ConnectionInput, ConnectionType, SshConfig } from '@shared/domain'
import { useAppStore } from '../state/store'
import {
  useConnections,
  useSaveConnection,
  useDeleteConnection,
  useTestConnection,
} from '../lib/hooks'
import SshHopEditor from './SshHopEditor'
import { emptyHop, validateSshConfig } from '../lib/ssh-config'

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORTS: Record<ConnectionType, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017,
}

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
}

// ── Test status ──────────────────────────────────────────────────────────────

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
      })
      setPassword('') // blank = keep current on edit
    } else if (!isEdit) {
      setForm(DEFAULT_INPUT)
      setPassword('')
    }
    setSshSecrets({}) // typed-this-session only; never preload stored secrets
    setTestStatus({ kind: 'idle' })
    setSaveError(null)
  }, [isEdit, existingConn])

  const save = useSaveConnection()
  const del = useDeleteConnection()
  const test = useTestConnection()

  function setField<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaveError(null)
  }

  function handleTypeChange(newType: ConnectionType) {
    const prevDefault = DEFAULT_PORTS[form.type]
    const nextDefault = DEFAULT_PORTS[newType]
    setForm((prev) => ({
      ...prev,
      type: newType,
      // Switch port only if it's still on the previous type's default
      port: prev.port === prevDefault ? nextDefault : prev.port,
    }))
    setSaveError(null)
  }

  function setSshEnabled(enabled: boolean) {
    const cur: SshConfig = form.ssh ?? { enabled: false, hops: [] }
    // Enabling with no hops yet seeds one so the editor isn't empty.
    const hops = enabled && cur.hops.length === 0 ? [emptyHop(crypto.randomUUID())] : cur.hops
    setField('ssh', { enabled, hops })
  }

  function handleTest() {
    const sshErr = validateSshConfig(form.ssh)
    if (sshErr) { setTestStatus({ kind: 'err', message: sshErr }); return }
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
    if (sshErr) { setSaveError(sshErr); return }
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

  function handleDelete() {
    if (!editId) return
    if (!window.confirm(`Delete connection "${form.name}"? This cannot be undone.`)) return
    del.mutate(editId, {
      onSuccess: () => {
        // Read fresh: closeTabsForConnection (the delete hook) may have already handed the active
        // connection to a remaining group; only clear it if the deleted one is still active.
        if (useAppStore.getState().activeConnectionId === editId) setActiveConnection(null)
        closeModal()
      },
    })
  }

  const canSave =
    form.name.trim().length > 0 &&
    form.host.trim().length > 0 &&
    form.port > 0

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
      <div className="modal">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Connection' : 'New Connection'}</h2>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            {/* Name */}
            <div className="form-row">
              <label htmlFor="conn-name">Name</label>
              <input
                id="conn-name"
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="My Database"
                autoFocus
              />
            </div>

            {/* Type */}
            <div className="form-row">
              <label htmlFor="conn-type">Type</label>
              <select
                id="conn-type"
                value={form.type}
                onChange={(e) => handleTypeChange(e.target.value as ConnectionType)}
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="mariadb">MariaDB</option>
                <option value="mongodb">MongoDB</option>
              </select>
            </div>

            {/* Host + Port */}
            <div className="form-row-2">
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
                  value={form.port}
                  min={1}
                  max={65535}
                  onChange={(e) => setField('port', Number(e.target.value))}
                />
              </div>
            </div>

            {/* Username + Database */}
            <div className="form-row-2">
              <div className="form-row">
                <label htmlFor="conn-user">Username</label>
                <input
                  id="conn-user"
                  type="text"
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="conn-db">Database</label>
                <input
                  id="conn-db"
                  type="text"
                  value={form.database}
                  onChange={(e) => setField('database', e.target.value)}
                  placeholder={form.type === 'mongodb' ? 'blank = browse all databases' : ''}
                />
              </div>
            </div>

            {/* Mongo-only: auth source + replica set */}
            {form.type === 'mongodb' && (
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

            {/* Password */}
            <div className="form-row">
              <label htmlFor="conn-password">Password</label>
              <input
                id="conn-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? 'leave blank to keep current' : ''}
              />
            </div>

            {/* Color */}
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

            {/* SSL + Read-only */}
            <div className="form-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.ssl}
                  onChange={(e) => setField('ssl', e.target.checked)}
                />
                SSL/TLS
              </label>
            </div>
            <div className="form-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.readOnly}
                  onChange={(e) => setField('readOnly', e.target.checked)}
                />
                Read-only mode
              </label>
            </div>
            <div className="form-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.requireCommit}
                  disabled={form.readOnly}
                  onChange={(e) => setField('requireCommit', e.target.checked)}
                />
                Require explicit commit for cell edits
                <span className="hint"> — prevents fast commit/push; edits stage until you click Commit</span>
              </label>
            </div>

            {/* SSH tunnel */}
            <div className="form-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!form.ssh?.enabled}
                  onChange={(e) => setSshEnabled(e.target.checked)}
                />
                Use SSH tunnel
              </label>
            </div>
            {form.ssh?.enabled && (
              <SshHopEditor
                ssh={form.ssh}
                secrets={sshSecrets}
                isEdit={isEdit}
                onChange={(ssh) => setField('ssh', ssh)}
                onSecretChange={(hopId, value) => setSshSecrets((prev) => ({ ...prev, [hopId]: value }))}
              />
            )}

            {/* Test status */}
            {testStatus.kind === 'ok' && (
              <div className="status ok" role="status">✓ Connection OK</div>
            )}
            {testStatus.kind === 'err' && (
              <div className="status err" role="alert">{testStatus.message}</div>
            )}

            {/* Save error */}
            {saveError && (
              <div className="status err" role="alert">{saveError}</div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {isEdit && (
            <button
              className="btn danger"
              onClick={handleDelete}
              disabled={del.isPending}
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </button>
          )}

          <button
            className="btn ghost"
            onClick={handleTest}
            disabled={testStatus.kind === 'pending' || !canSave}
            aria-label="Test connection"
          >
            {testStatus.kind === 'pending' ? 'Testing…' : 'Test'}
          </button>

          <span className="spacer" />

          <button className="btn ghost" onClick={closeModal}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!canSave || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
