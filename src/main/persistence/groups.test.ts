import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection, getConnection, listConnections, setConnectionGroup } from './connections'
import { createGroup, listGroups, renameGroup, deleteGroup } from './groups'
import type { ConnectionInput } from '../../shared/domain'

const input: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1,
  username: 'u', database: 'd', ssl: false, readOnly: false, requireCommit: true,
  authSource: '', replicaSet: '', ssh: null, repoPath: null
}

let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('groups service', () => {
  it('creates a group with a trimmed name and increasing positions', () => {
    const a = createGroup(db, '  desarrollo  ', 10)
    const b = createGroup(db, 'staging', 20)
    expect(a.id).toBeTruthy()
    expect(a.name).toBe('desarrollo')
    expect(a.position).toBe(0)
    expect(a.createdAt).toBe(10)
    expect(b.position).toBe(1)
  })

  it('throws on a blank name', () => {
    expect(() => createGroup(db, '   ', 1)).toThrow(/empty/i)
    expect(() => createGroup(db, '', 1)).toThrow(/empty/i)
  })

  it('lists groups in position order', () => {
    // Timestamps deliberately out of order: position (append order), not created_at, rules the list.
    createGroup(db, 'first', 30)
    createGroup(db, 'second', 10)
    createGroup(db, 'third', 20)
    expect(listGroups(db).map((g) => g.name)).toEqual(['first', 'second', 'third'])
    expect(listGroups(db).map((g) => g.position)).toEqual([0, 1, 2])
  })

  it('renames a group (trimmed) and validates the name', () => {
    const g = createGroup(db, 'old', 1)
    const r = renameGroup(db, g.id, '  new  ')
    expect(r.name).toBe('new')
    expect(r.id).toBe(g.id)
    expect(r.position).toBe(g.position)
    expect(listGroups(db).map((x) => x.name)).toEqual(['new'])
    expect(() => renameGroup(db, g.id, '  ')).toThrow(/empty/i)
  })

  it('throws when renaming a missing id', () => {
    expect(() => renameGroup(db, 'nope', 'x')).toThrow(/not found/i)
  })

  it('deletes a group, ungrouping (not deleting) its connections via the FK', () => {
    const c = createConnection(db, input, 1)
    const g = createGroup(db, 'devs', 2)
    setConnectionGroup(db, c.id, g.id, 3)
    expect(getConnection(db, c.id)!.groupId).toBe(g.id)

    deleteGroup(db, g.id)
    expect(listGroups(db)).toEqual([])
    const after = getConnection(db, c.id)
    expect(after).not.toBeNull() // the connection survives
    expect(after!.groupId).toBeNull() // ON DELETE SET NULL ungrouped it
  })

  it('stays idempotent when migrate runs twice on the same database', () => {
    migrate(db) // second run over an already-migrated schema
    const g = createGroup(db, 'ok', 1)
    expect(listGroups(db)).toEqual([g])
  })
})

describe('setConnectionGroup', () => {
  it('throws for an unknown group', () => {
    const c = createConnection(db, input, 1)
    expect(() => setConnectionGroup(db, c.id, 'nope', 2)).toThrow(/group not found/i)
  })

  it('throws for an unknown connection', () => {
    const g = createGroup(db, 'g', 1)
    expect(() => setConnectionGroup(db, 'nope', g.id, 2)).toThrow(/connection not found/i)
  })

  it('assigns, then clears back to null', () => {
    const c = createConnection(db, input, 1)
    const g = createGroup(db, 'g', 2)
    const grouped = setConnectionGroup(db, c.id, g.id, 3)
    expect(grouped.groupId).toBe(g.id)
    expect(grouped.updatedAt).toBe(3)
    const cleared = setConnectionGroup(db, c.id, null, 4)
    expect(cleared.groupId).toBeNull()
    expect(cleared.updatedAt).toBe(4)
  })

  it('new connections default to ungrouped and listConnections carries groupId', () => {
    const c1 = createConnection(db, { ...input, name: 'a' }, 1)
    const c2 = createConnection(db, { ...input, name: 'b' }, 2)
    expect(c1.groupId).toBeNull()
    const g = createGroup(db, 'g', 3)
    setConnectionGroup(db, c2.id, g.id, 4)
    const byName = new Map(listConnections(db).map((c) => [c.name, c.groupId]))
    expect(byName.get('a')).toBeNull()
    expect(byName.get('b')).toBe(g.id)
  })
})
