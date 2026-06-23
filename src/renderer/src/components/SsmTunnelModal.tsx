import { useEffect, useState } from 'react'
import { useSaveSsmTunnel, useConnections } from '../lib/hooks'
import type { SsmTunnel, SsmTunnelInput, AwsInstance } from '@shared/domain'

const EMPTY: SsmTunnelInput = {
  name: '', profile: '', region: 'eu-west-3', instanceId: '', remotePort: 3306, localPort: 13306, connectionId: null
}

/** Type-to-search instance picker: filters the live instance list by name or id as you type; pick a
 *  match or paste an id manually (the field IS the instance id). */
function InstanceCombobox({ instances, value, onChange }: { instances: AwsInstance[]; value: string; onChange: (id: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const q = value.trim().toLowerCase()
  const matches = instances.filter((i) => i.name.toLowerCase().includes(q) || i.instanceId.toLowerCase().includes(q))
  return (
    <div className="combo">
      <input
        id="ssm-instance"
        value={value}
        autoComplete="off"
        placeholder="Type to search, or paste i-0123…"
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && instances.length > 0 && (
        <div className="combo-list">
          {matches.length === 0 && <div className="combo-empty">No instance matches.</div>}
          {matches.slice(0, 50).map((i) => (
            <button
              type="button"
              key={i.instanceId}
              className="combo-item"
              // mousedown-preventDefault keeps the input focused so this click lands before the blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(i.instanceId); setOpen(false) }}
            >
              <span className="combo-name">{i.name}</span>
              {i.ping && i.ping !== 'Online' && <span className="combo-ping">{i.ping}</span>}
              <span className="combo-id">{i.instanceId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Auth = { status: 'idle' | 'checking' | 'ok' | 'fail'; arn?: string; error?: string }

/** Add/edit an SSM tunnel. The AWS connector lets you pick a profile, sign in (SSO), and choose the
 *  target from the live instance list instead of typing an id. Values stay only in the local sqlite. */
export default function SsmTunnelModal({ tunnel, onClose }: { tunnel: SsmTunnel | null; onClose: () => void }): JSX.Element {
  const { data: connections = [] } = useConnections()
  const save = useSaveSsmTunnel()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<SsmTunnelInput>(
    tunnel
      ? { name: tunnel.name, profile: tunnel.profile, region: tunnel.region, instanceId: tunnel.instanceId, remotePort: tunnel.remotePort, localPort: tunnel.localPort, connectionId: tunnel.connectionId }
      : EMPTY
  )

  // ── AWS connector ──
  const [profiles, setProfiles] = useState<string[]>([])
  const [auth, setAuth] = useState<Auth>({ status: 'idle' })
  const [instances, setInstances] = useState<AwsInstance[]>([])
  const [loadingInstances, setLoadingInstances] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)

  useEffect(() => {
    window.api.aws.profiles().then((r) => {
      if (!r.ok) return
      setProfiles(r.data)
      setForm((f) => (f.profile || !r.data[0] ? f : { ...f, profile: r.data[0] }))
    })
  }, [])

  function set<K extends keyof SsmTunnelInput>(k: K, v: SsmTunnelInput[K]): void {
    setForm((f) => ({ ...f, [k]: v }))
    setError(null)
    if (k === 'profile' || k === 'region') { setAuth({ status: 'idle' }); setInstances([]) }
  }

  async function loadInstances(): Promise<void> {
    setLoadingInstances(true)
    const r = await window.api.aws.instances(form.profile, form.region)
    setLoadingInstances(false)
    if (r.ok) setInstances(r.data)
  }
  async function checkLogin(): Promise<void> {
    if (!form.profile || !form.region) return
    setAuth({ status: 'checking' })
    setInstances([])
    const r = await window.api.aws.identity(form.profile, form.region)
    if (r.ok) { setAuth({ status: 'ok', arn: r.data.arn }); void loadInstances() }
    else setAuth({ status: 'fail', error: r.error })
  }
  async function login(): Promise<void> {
    setLoginBusy(true)
    const r = await window.api.aws.login(form.profile)
    setLoginBusy(false)
    if (r.ok) void checkLogin()
    else setAuth({ status: 'fail', error: r.error })
  }

  const canSave =
    form.name.trim().length > 0 && form.profile.trim().length > 0 && form.region.trim().length > 0 &&
    form.instanceId.trim().length > 0 && form.localPort > 0 && form.remotePort > 0
  function submit(): void {
    save.mutate({ id: tunnel?.id, input: form }, { onSuccess: onClose, onError: (e) => setError(e instanceof Error ? e.message : String(e)) })
  }

  // Editing a tunnel whose profile isn't in ~/.aws should still show it as the selected option.
  const profileOptions = form.profile && !profiles.includes(form.profile) ? [form.profile, ...profiles] : profiles

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

            <div className="form-row-2">
              <div className="form-row">
                <label htmlFor="ssm-profile">AWS profile</label>
                {profileOptions.length > 0 ? (
                  <select id="ssm-profile" value={form.profile} onChange={(e) => set('profile', e.target.value)}>
                    {profileOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input id="ssm-profile" value={form.profile} onChange={(e) => set('profile', e.target.value)} placeholder="you@company.com" />
                )}
              </div>
              <div className="form-row">
                <label htmlFor="ssm-region">Region</label>
                <input id="ssm-region" value={form.region} onChange={(e) => set('region', e.target.value)} placeholder="eu-west-3" />
              </div>
            </div>

            <div className="form-row">
              <label>AWS sign-in</label>
              <div className="aws-auth">
                <button type="button" className="btn ghost" onClick={checkLogin} disabled={!form.profile || auth.status === 'checking'}>
                  {auth.status === 'checking' ? 'Checking…' : 'Check login'}
                </button>
                {auth.status === 'ok' && <span className="aws-ok" title={auth.arn}>✓ {auth.arn?.split('/').pop()}</span>}
                {auth.status === 'fail' && (
                  <>
                    <span className="aws-fail">✗ not signed in</span>
                    <button type="button" className="btn primary xs" onClick={login} disabled={loginBusy}>
                      {loginBusy ? 'Opening browser…' : 'Log in (SSO)'}
                    </button>
                  </>
                )}
              </div>
              {auth.status === 'fail' && auth.error && <div className="aws-error">{auth.error}</div>}
            </div>

            <div className="form-row">
              <label htmlFor="ssm-instance">
                Instance {loadingInstances && <span className="hint">loading…</span>}
              </label>
              <InstanceCombobox instances={instances} value={form.instanceId} onChange={(id) => set('instanceId', id)} />
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
