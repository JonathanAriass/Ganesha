import { useState } from 'react'
import { useSaveSsmTunnel, useConnections } from '../lib/hooks'
import type { SsmTunnel, SsmTunnelInput } from '@shared/domain'

const EMPTY: SsmTunnelInput = {
  name: '', profile: '', region: 'eu-west-3', instanceId: '', remotePort: 3306, localPort: 13306, connectionId: null
}

/** Add/edit an SSM tunnel config. Values (incl. the instance id / profile) are stored only in the
 *  local sqlite — never in committed source. */
export default function SsmTunnelModal({ tunnel, onClose }: { tunnel: SsmTunnel | null; onClose: () => void }): JSX.Element {
  const { data: connections = [] } = useConnections()
  const save = useSaveSsmTunnel()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<SsmTunnelInput>(
    tunnel
      ? { name: tunnel.name, profile: tunnel.profile, region: tunnel.region, instanceId: tunnel.instanceId, remotePort: tunnel.remotePort, localPort: tunnel.localPort, connectionId: tunnel.connectionId }
      : EMPTY
  )
  function set<K extends keyof SsmTunnelInput>(k: K, v: SsmTunnelInput[K]): void {
    setForm((f) => ({ ...f, [k]: v }))
    setError(null)
  }
  const canSave =
    form.name.trim().length > 0 && form.profile.trim().length > 0 && form.region.trim().length > 0 &&
    form.instanceId.trim().length > 0 && form.localPort > 0 && form.remotePort > 0

  function submit(): void {
    save.mutate(
      { id: tunnel?.id, input: form },
      { onSuccess: onClose, onError: (e) => setError(e instanceof Error ? e.message : String(e)) }
    )
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header"><h2>{tunnel ? 'Edit SSM tunnel' : 'New SSM tunnel'}</h2></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label htmlFor="ssm-name">Name</label>
              <input id="ssm-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Swan PROD master" autoFocus />
            </div>
            <div className="form-row">
              <label htmlFor="ssm-profile">AWS profile</label>
              <input id="ssm-profile" value={form.profile} onChange={(e) => set('profile', e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="form-row-2">
              <div className="form-row">
                <label htmlFor="ssm-region">Region</label>
                <input id="ssm-region" value={form.region} onChange={(e) => set('region', e.target.value)} placeholder="eu-west-3" />
              </div>
              <div className="form-row">
                <label htmlFor="ssm-instance">Instance id</label>
                <input id="ssm-instance" value={form.instanceId} onChange={(e) => set('instanceId', e.target.value)} placeholder="i-0123456789abcdef0" />
              </div>
            </div>
            <div className="form-row-2">
              <div className="form-row">
                <label htmlFor="ssm-remote">Remote port</label>
                <input id="ssm-remote" type="number" value={form.remotePort} min={1} max={65535} onChange={(e) => set('remotePort', Number(e.target.value))} />
              </div>
              <div className="form-row">
                <label htmlFor="ssm-local">Local port</label>
                <input id="ssm-local" type="number" value={form.localPort} min={1} max={65535} onChange={(e) => set('localPort', Number(e.target.value))} />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="ssm-conn">Linked connection <span className="hint">(optional — warns when this tunnel is down)</span></label>
              <select id="ssm-conn" value={form.connectionId ?? ''} onChange={(e) => set('connectionId', e.target.value || null)}>
                <option value="">— none —</option>
                {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {error && <div className="status err" role="alert">{error}</div>}
          </div>
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSave || save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
