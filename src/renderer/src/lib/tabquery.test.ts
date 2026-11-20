import { describe, it, expect } from 'vitest'
import { defaultTableQuery } from './tabquery'

describe('defaultTableQuery', () => {
  it('mongo: plain db when the connection has a default database (no ref.schema)', () => {
    expect(defaultTableQuery('mongodb', { schema: null, name: 'users' })).toBe('db.users.find({}).limit(100)')
    expect(defaultTableQuery('mongodb', { schema: null, name: 'my coll' })).toBe('db["my coll"].find({}).limit(100)')
  })

  it('mongo: getSiblingDB targets the tree-tagged database in browse-all mode', () => {
    expect(defaultTableQuery('mongodb', { schema: 'other', name: 'users' })).toBe(
      'db.getSiblingDB("other").users.find({}).limit(100)'
    )
    expect(defaultTableQuery('mongodb', { schema: 'other', name: 'my coll' })).toBe(
      'db.getSiblingDB("other")["my coll"].find({}).limit(100)'
    )
  })

  it('sql flavors are untouched by schema-tagged refs', () => {
    expect(defaultTableQuery('postgres', { schema: 'public', name: 't' })).toBe(
      'SELECT * FROM "public"."t" LIMIT 100'
    )
    expect(defaultTableQuery('mysql', { schema: null, name: 't' })).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('asks for the configured number of rows', () => {
    expect(defaultTableQuery('mongodb', { schema: null, name: 'users' }, 25)).toBe('db.users.find({}).limit(25)')
    expect(defaultTableQuery('postgres', { schema: 'public', name: 't' }, 500)).toBe('SELECT * FROM "public"."t" LIMIT 500')
    expect(defaultTableQuery('mariadb', { schema: null, name: 't' }, 500)).toBe('SELECT * FROM `t` LIMIT 500')
  })
})
