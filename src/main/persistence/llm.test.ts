import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection } from './connections'
import { createConversation, listConversations, deleteConversation, addMessage, listMessages, touchConversation } from './llm'
import type { ConnectionInput } from '../../shared/domain'

const conn: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1, username: 'u',
  database: 'd', ssl: false, readOnly: false, requireCommit: true, authSource: '', replicaSet: '', ssh: null
}
let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('llm persistence', () => {
  it('creates and lists conversations per connection, newest first', () => {
    const c = createConnection(db, conn, 1)
    const a = createConversation(db, c.id, 'first', 10)
    const b = createConversation(db, c.id, 'second', 20)
    const list = listConversations(db, c.id)
    expect(list.map((x) => x.id)).toEqual([b.id, a.id])
    expect(list[0].title).toBe('second')
  })

  it('stores and reads messages in chronological order', () => {
    const c = createConnection(db, conn, 1)
    const conv = createConversation(db, c.id, 't', 1)
    addMessage(db, conv.id, 'user', 'hi', 2)
    addMessage(db, conv.id, 'assistant', 'hello', 3)
    expect(listMessages(db, conv.id).map((m) => [m.role, m.content])).toEqual([['user', 'hi'], ['assistant', 'hello']])
  })

  it('touch bumps updated_at for ordering', () => {
    const c = createConnection(db, conn, 1)
    const a = createConversation(db, c.id, 'a', 1)
    createConversation(db, c.id, 'b', 2)
    touchConversation(db, a.id, 99)
    expect(listConversations(db, c.id)[0].id).toBe(a.id)
  })

  it('cascades: deleting a conversation removes its messages; deleting the connection removes conversations', () => {
    const c = createConnection(db, conn, 1)
    const conv = createConversation(db, c.id, 't', 1)
    addMessage(db, conv.id, 'user', 'x', 2)
    deleteConversation(db, conv.id)
    expect(listMessages(db, conv.id)).toEqual([])
    const conv2 = createConversation(db, c.id, 't2', 3)
    db.prepare('DELETE FROM connections WHERE id = ?').run(c.id)
    expect(listConversations(db, c.id)).toEqual([])
    expect(listMessages(db, conv2.id)).toEqual([])
  })
})
