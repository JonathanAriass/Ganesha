import { describe, it, expect } from 'vitest'
import { defaultTableQuery } from './tabquery'

describe('defaultTableQuery', () => {
  it('mongo: plain db when the connection has a default database (no ref.schema)', () => {
    expect(defaultTableQuery('mongodb', { schema: null, name: 'users' })).toBe('db.users.find({})')
    expect(defaultTableQuery('mongodb', { schema: null, name: 'my coll' })).toBe('db["my coll"].find({})')
  })

  it('mongo: getSiblingDB targets the tree-tagged database in browse-all mode', () => {
    expect(defaultTableQuery('mongodb', { schema: 'other', name: 'users' })).toBe(
      'db.getSiblingDB("other").users.find({})'
    )
    expect(defaultTableQuery('mongodb', { schema: 'other', name: 'my coll' })).toBe(
      'db.getSiblingDB("other")["my coll"].find({})'
    )
  })

  it('sql flavors are untouched by schema-tagged refs', () => {
    expect(defaultTableQuery('postgres', { schema: 'public', name: 't' })).toBe(
      'SELECT * FROM "public"."t" LIMIT 100'
    )
    expect(defaultTableQuery('mysql', { schema: null, name: 't' })).toBe('SELECT * FROM `t` LIMIT 100')
  })
})
