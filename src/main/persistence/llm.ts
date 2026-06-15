import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { LlmConversation, LlmMessage } from '../../shared/domain'

export function createConversation(db: DB, connectionId: string, title: string, now: number): LlmConversation {
  const id = randomUUID()
  db.prepare(`INSERT INTO llm_conversations (id, connection_id, title, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, connectionId, title, now, now)
  return { id, connectionId, title, createdAt: now, updatedAt: now }
}

export function listConversations(db: DB, connectionId: string): LlmConversation[] {
  const rows = db.prepare(
    `SELECT id, connection_id, title, created_at, updated_at FROM llm_conversations
     WHERE connection_id = ? ORDER BY updated_at DESC, created_at DESC`
  ).all(connectionId) as Array<{ id: string; connection_id: string; title: string; created_at: number; updated_at: number }>
  return rows.map((r) => ({ id: r.id, connectionId: r.connection_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }))
}

export function deleteConversation(db: DB, id: string): void {
  db.prepare('DELETE FROM llm_conversations WHERE id = ?').run(id)
}

export function touchConversation(db: DB, id: string, now: number): void {
  db.prepare('UPDATE llm_conversations SET updated_at = ? WHERE id = ?').run(now, id)
}

export function addMessage(db: DB, conversationId: string, role: 'user' | 'assistant', content: string, now: number): LlmMessage {
  const id = randomUUID()
  db.prepare(`INSERT INTO llm_messages (id, conversation_id, role, content, created_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, conversationId, role, content, now)
  return { id, conversationId, role, content, createdAt: now }
}

export function listMessages(db: DB, conversationId: string): LlmMessage[] {
  const rows = db.prepare(
    // rowid tiebreak = insertion order, so same-millisecond writes never reorder
    // (a random-UUID id tiebreak could sort an answer before its question).
    `SELECT id, conversation_id, role, content, created_at FROM llm_messages
     WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`
  ).all(conversationId) as Array<{ id: string; conversation_id: string; role: string; content: string; created_at: number }>
  return rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, role: r.role as 'user' | 'assistant', content: r.content, createdAt: r.created_at }))
}
