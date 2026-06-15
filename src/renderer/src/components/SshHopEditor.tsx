import type { SshConfig, SshHop } from '@shared/domain'
import { emptyHop } from '../lib/ssh-config'
import { unwrap } from '../lib/result'

interface Props {
  ssh: SshConfig
  /** Typed passphrases/passwords by hop id (write-only; blank = keep existing on edit). */
  secrets: Record<string, string>
  isEdit: boolean
  onChange: (ssh: SshConfig) => void
  onSecretChange: (hopId: string, value: string) => void
}

export default function SshHopEditor({ ssh, secrets, isEdit, onChange, onSecretChange }: Props): JSX.Element {
  function patchHop(i: number, patch: Partial<SshHop>): void {
    onChange({ ...ssh, hops: ssh.hops.map((h, j) => (j === i ? { ...h, ...patch } : h)) })
  }
  function addHop(): void {
    onChange({ ...ssh, hops: [...ssh.hops, emptyHop(crypto.randomUUID())] })
  }
  function removeHop(i: number): void {
    onChange({ ...ssh, hops: ssh.hops.filter((_, j) => j !== i) })
  }
  function move(i: number, dir: -1 | 1): void {
    const j = i + dir
    if (j < 0 || j >= ssh.hops.length) return
    const hops = ssh.hops.slice()
    ;[hops[i], hops[j]] = [hops[j], hops[i]]
    onChange({ ...ssh, hops })
  }
  async function pickKey(i: number): Promise<void> {
    const path = unwrap(await window.api.dialog.openFile('Select private key'))
    if (path) patchHop(i, { keyPath: path })
  }

  return (
    <div className="ssh-hops">
      {ssh.hops.map((h, i) => (
        <div className="ssh-hop" key={h.id}>
          <div className="ssh-hop-head">
            <span className="ssh-hop-order">{i === ssh.hops.length - 1 ? 'Target' : `Jump #${i + 1}`}</span>
            <span className="spacer" />
            <button type="button" className="btn ghost xs" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move hop up">↑</button>
            <button type="button" className="btn ghost xs" onClick={() => move(i, 1)} disabled={i === ssh.hops.length - 1} aria-label="Move hop down">↓</button>
            <button type="button" className="btn ghost xs" onClick={() => removeHop(i)} aria-label="Remove hop">✕</button>
          </div>
          <div className="form-row-2">
            <div className="form-row">
              <label>Host</label>
              <input type="text" value={h.host} onChange={(e) => patchHop(i, { host: e.target.value })} placeholder="35.180.247.138" />
            </div>
            <div className="form-row" style={{ maxWidth: 96 }}>
              <label>Port</label>
              <input type="number" value={h.port} min={1} max={65535} onChange={(e) => patchHop(i, { port: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form-row">
            <label>Username</label>
            <input type="text" value={h.username} onChange={(e) => patchHop(i, { username: e.target.value })} placeholder="ec2-user" />
          </div>
          <div className="form-row">
            <label>Auth</label>
            <select value={h.auth} onChange={(e) => patchHop(i, { auth: e.target.value as SshHop['auth'] })}>
              <option value="key">Private key</option>
              <option value="password">Password</option>
            </select>
          </div>
          {h.auth === 'key' ? (
            <>
              <div className="form-row">
                <label>Private key</label>
                <div className="ssh-key-pick">
                  <input type="text" value={h.keyPath} onChange={(e) => patchHop(i, { keyPath: e.target.value })} placeholder="/Users/me/aws.pem" />
                  <button type="button" className="btn ghost" onClick={() => void pickKey(i)}>Browse…</button>
                </div>
              </div>
              <div className="form-row">
                <label>Passphrase</label>
                <input type="password" value={secrets[h.id] ?? ''} onChange={(e) => onSecretChange(h.id, e.target.value)} placeholder={isEdit ? 'leave blank to keep current' : 'optional'} />
              </div>
            </>
          ) : (
            <div className="form-row">
              <label>Password</label>
              <input type="password" value={secrets[h.id] ?? ''} onChange={(e) => onSecretChange(h.id, e.target.value)} placeholder={isEdit ? 'leave blank to keep current' : ''} />
            </div>
          )}
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={addHop}>+ Add hop</button>
    </div>
  )
}
