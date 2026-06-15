import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../state/store'
import { useLlmModels } from '../lib/hooks'

export default function ModelManagerModal(): JSX.Element | null {
  const open = useAppStore((s) => s.modelManagerOpen)
  const close = useAppStore((s) => s.closeModelManager)
  const { data } = useLlmModels()
  const qc = useQueryClient()
  const [customUri, setCustomUri] = useState('')
  const [progress, setProgress] = useState<{ uri: string; pct: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return window.api.llm.onDownloadProgress((e) => {
      if (e.error) { setError(e.error); setProgress(null); return }
      if (e.done) { setProgress(null); void qc.invalidateQueries({ queryKey: ['llm', 'models'] }); return }
      setProgress({ uri: e.uri, pct: e.totalBytes ? Math.round(((e.receivedBytes ?? 0) / e.totalBytes) * 100) : 0 })
    })
  }, [qc])

  if (!open) return null

  async function download(uri: string): Promise<void> {
    setError(null)
    setProgress({ uri, pct: 0 })
    const res = await window.api.llm.downloadModel(uri)
    if (!res.ok) { setError(res.error); setProgress(null) }
  }
  async function del(id: string): Promise<void> {
    await window.api.llm.deleteModel(id)
    void qc.invalidateQueries({ queryKey: ['llm', 'models'] })
  }
  async function setActive(id: string): Promise<void> {
    await window.api.llm.setActiveModel(id)
    void qc.invalidateQueries({ queryKey: ['llm', 'models'] })
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Model manager"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="modal">
        <div className="modal-header"><h2>Model Manager</h2></div>
        <div className="modal-body">
          <h3>Downloaded</h3>
          {(data?.downloaded.length ?? 0) === 0 && <p className="tree-muted">None yet — pick one from the catalog below.</p>}
          {data?.downloaded.map((m) => (
            <div className="model-row" key={m.id}>
              <span>{m.name} <span className="tree-muted">({(m.sizeBytes / 1e9).toFixed(1)} GB)</span></span>
              <span className="spacer" />
              {data.activeModelId === m.id
                ? <span className="status ok">active</span>
                : <button className="btn ghost xs" onClick={() => void setActive(m.id)}>Set active</button>}
              <button className="btn ghost xs" onClick={() => void del(m.id)}>Delete</button>
            </div>
          ))}

          <h3>Catalog</h3>
          {data?.catalog.map((m) => (
            <div className="model-row" key={m.id}>
              <span>
                {m.name} <span className="tree-muted">{m.sizeLabel}</span>
                <br /><span className="tree-muted">{m.description}</span>
              </span>
              <span className="spacer" />
              {/* Re-downloading is idempotent (node-llama-cpp resolves to the existing
                  file), and the HF filename doesn't carry the catalog slug, so we don't
                  try to show a (fragile) "already downloaded" state — the Downloaded
                  section above is the source of truth. */}
              <button className="btn xs" disabled={!!progress} onClick={() => void download(m.uri)}>Download</button>
            </div>
          ))}

          <h3>Advanced</h3>
          <div className="ssh-key-pick">
            <input
              type="text"
              placeholder="hf:org/repo:quant"
              value={customUri}
              onChange={(e) => setCustomUri(e.target.value)}
            />
            <button className="btn" disabled={!customUri.trim() || !!progress} onClick={() => void download(customUri.trim())}>
              Download
            </button>
          </div>

          {progress && <div className="status">Downloading… {progress.pct}%</div>}
          {error && <div className="status err" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  )
}
