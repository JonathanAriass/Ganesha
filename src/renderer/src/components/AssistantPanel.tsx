import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../state/store'
import { useLlmModels, useLlmConversations, useLlmMessages, useEngineStatus } from '../lib/hooks'
import { extractCodeBlocks } from '../lib/llm-blocks'
import { clampWidth, dragWidth, loadWidth, saveWidth, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH } from '../lib/assistant-width'
import type { LlmMessage } from '@shared/domain'
import type { LlmContextFile } from '@shared/ipc'

let liveSeq = 0
function mkMsg(conversationId: string, role: 'user' | 'assistant', content: string): LlmMessage {
  return { id: `live-${liveSeq++}`, conversationId, role, content, createdAt: 0 }
}

export default function AssistantPanel(): JSX.Element {
  const open = useAppStore((s) => s.assistantOpen)
  const toggle = useAppStore((s) => s.toggleAssistant)
  const ssmOpen = useAppStore((s) => s.ssmOpen)
  const openModelManager = useAppStore((s) => s.openModelManager)
  const connectionId = useAppStore((s) => s.activeConnectionId)
  const convId = useAppStore((s) => s.activeConversationId)
  const setConv = useAppStore((s) => s.setActiveConversation)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  // The active tab's SQL (when it belongs to this connection) — sharpens repo retrieval to the
  // tables actually on screen. Empty when the active tab is for another connection.
  const queryText = useAppStore((s) => {
    const t = s.tabs.find((tab) => tab.id === s.activeTabId)
    return t && t.connectionId === s.activeConnectionId ? t.text : ''
  })

  const qc = useQueryClient()
  const { data: models } = useLlmModels()
  const { data: engine } = useEngineStatus()
  const { data: conversations } = useLlmConversations(connectionId)
  const { data: persisted } = useLlmMessages(convId)

  const [draft, setDraft] = useState('')
  const [live, setLive] = useState<LlmMessage[]>([]) // optimistic user msg + streaming assistant msg
  const [streaming, setStreaming] = useState(false)
  const [contextFiles, setContextFiles] = useState<LlmContextFile[]>([]) // linked-repo files grounding the latest turn
  const [showContext, setShowContext] = useState(false) // 📎 line expanded to show the injected snippets
  const reqRef = useRef<string | null>(null)
  const cidRef = useRef<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  // ── Horizontal resize (drag the left edge) ──
  const panelRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(() => loadWidth())
  const widthRef = useRef(width) // leads every commit so same-tick key repeats accumulate
  function commitWidth(w: number): void {
    widthRef.current = w
    setWidth(w)
    saveWidth(w)
  }
  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    // Direct DOM write during the drag; commit to state + localStorage on pointerup
    // (a re-render per move would re-render the streaming thread).
    panelRef.current.style.width = `${dragWidth(e.clientX, panelRef.current.getBoundingClientRect().right)}px`
  }
  function onResizePointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panelRef.current) return
    commitWidth(clampWidth(panelRef.current.getBoundingClientRect().width))
  }
  function onResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    // Left edge of a right-docked panel: ArrowLeft widens, ArrowRight narrows.
    const step = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : null
    if (step === null) return
    e.preventDefault()
    commitWidth(clampWidth(widthRef.current + step))
  }

  const messages: LlmMessage[] = [...(persisted ?? []), ...live]

  useEffect(() => { threadRef.current?.scrollTo(0, threadRef.current.scrollHeight) }, [messages.length, live])

  // Subscribe once; route token events by the live requestId.
  useEffect(() => {
    return window.api.llm.onToken((e) => {
      if (e.requestId !== reqRef.current) return
      if (e.chunk) {
        setLive((prev) => {
          if (prev.length === 0) return prev
          const next = prev.slice()
          const last = next[next.length - 1]
          if (last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + e.chunk }
          return next
        })
      } else if (e.done || e.error) {
        if (e.error) { setLive((prev) => [...prev, mkMsg(cidRef.current ?? '', 'assistant', `⚠️ ${e.error}`)]); setContextFiles([]) }
        setStreaming(false)
        reqRef.current = null
        // Refetch persisted history (now includes the saved answer), then drop the optimistic copies.
        const cid = cidRef.current
        if (cid && !e.error) {
          void qc.invalidateQueries({ queryKey: ['llm', 'messages', cid] }).then(() => setLive([]))
        }
      }
    })
  }, [qc])

  // Linked-repo grounding for the current turn. Main emits this during setup, possibly before the
  // send() call resolves with the requestId, so we don't filter by it — the panel runs one
  // generation at a time and send() clears the list first.
  useEffect(() => window.api.llm.onContext((e) => setContextFiles(e.files)), [])

  async function ensureConversation(): Promise<string | null> {
    if (convId) return convId
    if (!connectionId) return null
    const res = await window.api.llm.createConversation(connectionId, draft.trim().slice(0, 40) || 'New chat')
    if (!res.ok) return null
    setConv(res.data.id)
    void qc.invalidateQueries({ queryKey: ['llm', 'conversations', connectionId] })
    return res.data.id
  }

  async function send(): Promise<void> {
    if (!draft.trim() || !connectionId || streaming) return
    const cid = await ensureConversation()
    if (!cid) return
    cidRef.current = cid
    const prompt = draft.trim()
    setDraft('')
    setLive([mkMsg(cid, 'user', prompt), mkMsg(cid, 'assistant', '')])
    setStreaming(true)
    setContextFiles([]); setShowContext(false) // clear last turn's grounding; onContext repopulates if the repo matched
    const res = await window.api.llm.send(cid, connectionId, prompt, queryText)
    if (res.ok) reqRef.current = res.data.requestId
    else { setStreaming(false); setContextFiles([]); setLive((prev) => [...prev, mkMsg(cid, 'assistant', `⚠️ ${res.error}`)]) }
  }

  function stop(): void { if (reqRef.current) void window.api.llm.cancel(reqRef.current) }

  const hasModel = (models?.downloaded.length ?? 0) > 0
  // Default true while the status query loads (main enforces the real gate) to avoid input flicker.
  const engineReady = engine?.installed ?? true
  const ready = hasModel && engineReady

  return (
    <>
      {/* Peek hides while the SSM panel is open — it floated over the SSM list.
          The TopBar toggle still opens the assistant regardless. */}
      {!open && !ssmOpen && (
        <button className="assistant-peek" onClick={toggle} aria-label="Open assistant">
          <span className="assistant-peek-label">✦ Assistant</span>
        </button>
      )}
      <aside
        className={`assistant-panel${open ? ' open' : ''}`}
        ref={panelRef}
        style={{ width }}
        aria-hidden={!open}
      >
      <div
        className="assistant-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title="Drag to resize · double-click to reset · ←/→ to adjust"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        onPointerCancel={onResizePointerEnd}
        onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
        onKeyDown={onResizeKeyDown}
      />
      <div className="assistant-head">
        <strong>Assistant</strong>
        <span className="spacer" />
        <select
          value={convId ?? ''}
          onChange={(e) => {
            if (reqRef.current) void window.api.llm.cancel(reqRef.current) // don't leave a generation running for a hidden chat
            setConv(e.target.value || null); setLive([]); reqRef.current = null; setStreaming(false); setContextFiles([])
          }}
          aria-label="Conversation"
        >
          <option value="">New chat</option>
          {(conversations ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button className="btn ghost xs" onClick={openModelManager} title="Manage models">⚙</button>
        <button
          className="btn ghost xs"
          onClick={() => {
            // Focus can't stay inside an aria-hidden subtree (the ✕ itself holds it post-click).
            ;(document.activeElement as HTMLElement | null)?.blur()
            toggle()
            // Hand focus to the peek once React has rendered it (it appears on close).
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.assistant-peek')?.focus())
          }}
          aria-label="Close assistant"
        >
          ✕
        </button>
      </div>

      {!connectionId && <div className="assistant-empty">Select a connection to get schema-aware suggestions.</div>}
      {connectionId && !engineReady && (
        <div className="assistant-empty">
          AI engine not installed — <button className="link-btn" onClick={openModelManager}>open the Model Manager</button> to download it (~2&nbsp;MB, once).
        </div>
      )}
      {connectionId && engineReady && !hasModel && (
        <div className="assistant-empty">
          No model yet — <button className="link-btn" onClick={openModelManager}>open the Model Manager</button> to download one.
        </div>
      )}

      <div className="assistant-thread" ref={threadRef}>
        {messages.map((m, i) => (
          <div key={m.id + i} className={`assistant-msg ${m.role}`}>
            <div className="assistant-msg-body">{m.content || (streaming && m.role === 'assistant' ? '…' : '')}</div>
            {m.role === 'assistant' && extractCodeBlocks(m.content).map((b, j) => (
              <div key={j} className="assistant-block">
                <pre>{b.code}</pre>
                <button
                  className="btn xs"
                  disabled={!connectionId}
                  onClick={() => connectionId && openQueryTab({ connectionId, title: 'Suggested', text: b.code, runOnOpen: false })}
                >
                  Insert into new tab
                </button>
              </div>
            ))}
          </div>
        ))}
        {contextFiles.length > 0 && (
          <div className="assistant-context">
            <button
              type="button"
              className="assistant-context-toggle"
              onClick={() => setShowContext((v) => !v)}
              aria-expanded={showContext}
              title="Linked-repo code the assistant read for this answer — click to see the exact snippets"
            >
              <span className="assistant-context-caret">{showContext ? '▾' : '▸'}</span> 📎 context:{' '}
              {contextFiles.map((f) => f.path).join(', ')}
            </button>
            {showContext && (
              <div className="assistant-context-detail">
                {contextFiles.map((f) => (
                  <div key={f.path} className="assistant-context-file">
                    <div className="assistant-context-path">
                      {f.path} <span className="assistant-context-table">· matched {f.table}</span>
                    </div>
                    <pre>{f.snippet}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="assistant-input">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={ready ? 'Ask for a query…  (⌘↵ to send)' : engineReady ? 'Download a model to start' : 'Install the AI engine to start'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
          disabled={!connectionId || !ready || streaming}
        />
        {streaming
          ? <button className="btn" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={() => void send()} disabled={!connectionId || !ready || !draft.trim()}>Send</button>}
      </div>
      </aside>
    </>
  )
}
