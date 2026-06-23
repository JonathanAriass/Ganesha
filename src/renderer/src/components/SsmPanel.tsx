import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { useSsmTunnels, useDeleteSsmTunnel } from '../lib/hooks'
import SsmTunnelModal from './SsmTunnelModal'
import type { SsmTunnel } from '@shared/domain'

/** Dockable panel managing AWS SSM port-forwarding tunnels: list with status + Start/Stop, the
 *  selected tunnel's live output, and an add/edit form. Running state comes from the store (kept
 *  live app-wide by the ssm:status subscription); output is buffered while the panel is open. */
export default function SsmPanel(): JSX.Element | null {
  const open = useAppStore((s) => s.ssmOpen)
  const toggle = useAppStore((s) => s.toggleSsm)
  const running = useAppStore((s) => s.runningSsm)
  const { data: tunnels } = useSsmTunnels()
  const del = useDeleteSsmTunnel()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<SsmTunnel | 'new' | null>(null)
  const outRef = useRef<HTMLPreElement>(null)

  useEffect(
    () => window.api.ssm.onOutput((e) => setOutputs((o) => ({ ...o, [e.id]: (o[e.id] ?? '') + e.chunk }))),
    []
  )
  useEffect(() => { outRef.current?.scrollTo(0, outRef.current.scrollHeight) }, [outputs, selectedId])

  if (!open) return null

  const list = tunnels ?? []
  const isRunning = (id: string): boolean => running.includes(id)
  const start = (id: string): void => { setSelectedId(id); void window.api.ssm.start(id) }

  return (
    <aside className="ssm-panel">
      <div className="ssm-head">
        <strong>SSM Tunnels</strong>
        <span className="spacer" style={{ marginLeft: 'auto' }} />
        <button className="btn ghost xs" onClick={() => setEditing('new')} title="Add tunnel" aria-label="Add tunnel">＋</button>
        <button className="btn ghost xs" onClick={toggle} aria-label="Close SSM panel">✕</button>
      </div>

      <div className="ssm-list">
        {list.length === 0 && (
          <div className="ssm-empty">
            No tunnels yet. <button className="link-btn" onClick={() => setEditing('new')}>Add one</button>.
          </div>
        )}
        {list.map((t) => (
          <div
            key={t.id}
            className={`ssm-row${selectedId === t.id ? ' selected' : ''}`}
            onClick={() => setSelectedId(t.id)}
          >
            <span className={`ssm-dot${isRunning(t.id) ? ' on' : ''}`} aria-hidden="true" />
            <span className="ssm-name" title={`${t.instanceId} · ${t.region}`}>{t.name}</span>
            <span className="ssm-port">127.0.0.1:{t.localPort}</span>
            {isRunning(t.id) ? (
              <button className="btn xs" onClick={(e) => { e.stopPropagation(); void window.api.ssm.stop(t.id) }}>Stop</button>
            ) : (
              <button className="btn xs primary" onClick={(e) => { e.stopPropagation(); start(t.id) }}>Start</button>
            )}
            <button className="btn ghost xs" onClick={(e) => { e.stopPropagation(); setEditing(t) }} title="Edit" aria-label="Edit">✎</button>
            <button
              className="btn ghost xs"
              onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete tunnel "${t.name}"?`)) del.mutate(t.id) }}
              title="Delete"
              aria-label="Delete"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="ssm-output">
        <div className="ssm-output-head">{selectedId ? list.find((t) => t.id === selectedId)?.name ?? 'Output' : 'Output'}</div>
        <pre ref={outRef} className="ssm-output-body">
          {selectedId ? outputs[selectedId] ?? '(no output yet)' : 'Select a tunnel to see its output.'}
        </pre>
      </div>

      {editing && <SsmTunnelModal tunnel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </aside>
  )
}
