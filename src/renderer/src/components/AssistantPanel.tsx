import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../state/store'
import { useLlmModels, useLlmConversations, useLlmMessages } from '../lib/hooks'
import { extractCodeBlocks } from '../lib/llm-blocks'
import type { LlmMessage } from '@shared/domain'

let liveSeq = 0
function mkMsg(conversationId: string, role: 'user' | 'assistant', content: string): LlmMessage {
  return { id: `live-${liveSeq++}`, conversationId, role, content, createdAt: 0 }
}

export default function AssistantPanel(): JSX.Element | null {
  const open = useAppStore((s) => s.assistantOpen)
  const toggle = useAppStore((s) => s.toggleAssistant)
  const openModelManager = useAppStore((s) => s.openModelManager)
  const connectionId = useAppStore((s) => s.activeConnectionId)
  const convId = useAppStore((s) => s.activeConversationId)
  const setConv = useAppStore((s) => s.setActiveConversation)
  const openQueryTab = useAppStore((s) => s.openQueryTab)

  const qc = useQueryClient()
  const { data: models } = useLlmModels()
  const { data: conversations } = useLlmConversations(connectionId)
  const { data: persisted } = useLlmMessages(convId)

  const [draft, setDraft] = useState('')
  const [live, setLive] = useState<LlmMessage[]>([]) // optimistic user msg + streaming assistant msg
  const [streaming, setStreaming] = useState(false)
  const reqRef = useRef<string | null>(null)
  const cidRef = useRef<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

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
        if (e.error) setLive((prev) => [...prev, mkMsg(cidRef.current ?? '', 'assistant', `⚠️ ${e.error}`)])
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
    const res = await window.api.llm.send(cid, connectionId, prompt)
    if (res.ok) reqRef.current = res.data.requestId
    else { setStreaming(false); setLive((prev) => [...prev, mkMsg(cid, 'assistant', `⚠️ ${res.error}`)]) }
  }

  function stop(): void { if (reqRef.current) void window.api.llm.cancel(reqRef.current) }

  if (!open) return null

  const hasModel = (models?.downloaded.length ?? 0) > 0

  return (
    <aside className="assistant-panel">
      <div className="assistant-head">
        <strong>Assistant</strong>
        <span className="spacer" />
        <select
          value={convId ?? ''}
          onChange={(e) => {
            if (reqRef.current) void window.api.llm.cancel(reqRef.current) // don't leave a generation running for a hidden chat
            setConv(e.target.value || null); setLive([]); reqRef.current = null; setStreaming(false)
          }}
          aria-label="Conversation"
        >
          <option value="">New chat</option>
          {(conversations ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button className="btn ghost xs" onClick={openModelManager} title="Manage models">⚙</button>
        <button className="btn ghost xs" onClick={toggle} aria-label="Close assistant">✕</button>
      </div>

      {!connectionId && <div className="assistant-empty">Select a connection to get schema-aware suggestions.</div>}
      {connectionId && !hasModel && (
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
      </div>

      <div className="assistant-input">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hasModel ? 'Ask for a query…  (⌘↵ to send)' : 'Download a model to start'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
          disabled={!connectionId || !hasModel || streaming}
        />
        {streaming
          ? <button className="btn" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={() => void send()} disabled={!connectionId || !hasModel || !draft.trim()}>Send</button>}
      </div>
    </aside>
  )
}
