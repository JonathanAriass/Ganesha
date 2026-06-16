import { describe, it, expect } from 'vitest'
import type { DbObject } from '@shared/schema'
import {
  sqlPlainSuggestions,
  sqlDatabaseSuggestions,
  sqlDotQualifier,
  sqlTableBindings,
  resolveSqlQualifier,
  columnSuggestions,
  schemaObjectSuggestions,
  sqlBoundRefs,
  unqualifiedColumnSuggestions,
  mongoCursorContext,
  mongoCollectionSuggestions,
  mongoOpSuggestions,
  mongoDatabaseSuggestions
} from './completions'

const SQL_OBJECTS: DbObject[] = [
  { schema: 'public', name: 'users', kind: 'table' },
  { schema: 'public', name: 'active_users', kind: 'view' },
  { schema: 'sales', name: 'orders', kind: 'table' }
]

describe('sqlPlainSuggestions', () => {
  it('offers keywords and all objects with their schema as detail', () => {
    const sugs = sqlPlainSuggestions(SQL_OBJECTS)
    expect(sugs).toContainEqual({ label: 'SELECT', kind: 'keyword', insertText: 'SELECT' })
    expect(sugs).toContainEqual({ label: 'users', kind: 'table', insertText: 'users', detail: 'public' })
    expect(sugs).toContainEqual({ label: 'active_users', kind: 'view', insertText: 'active_users', detail: 'public' })
  })
})

describe('sqlDatabaseSuggestions', () => {
  it('maps database/schema names to database-kind suggestions', () => {
    expect(sqlDatabaseSuggestions(['admin_okt', 'analytics'])).toEqual([
      { label: 'admin_okt', kind: 'database', insertText: 'admin_okt' },
      { label: 'analytics', kind: 'database', insertText: 'analytics' }
    ])
  })
  it('drops blanks/dupes and is empty for no databases', () => {
    expect(sqlDatabaseSuggestions([])).toEqual([])
    expect(sqlDatabaseSuggestions(['a', '', 'a', 'b'])).toEqual([
      { label: 'a', kind: 'database', insertText: 'a' },
      { label: 'b', kind: 'database', insertText: 'b' }
    ])
  })
})

describe('sqlDotQualifier', () => {
  it('captures the identifier before a trailing dot', () => {
    expect(sqlDotQualifier('select * from users u where u.')).toBe('u')
  })

  it('captures through a partial word after the dot', () => {
    expect(sqlDotQualifier('select u.na')).toBe('u')
  })

  it('is null with no dot context', () => {
    expect(sqlDotQualifier('select * from ')).toBeNull()
  })

  it('does not treat a decimal number as a qualifier', () => {
    expect(sqlDotQualifier('select 1.')).toBeNull()
  })

  it('captures a digit-leading identifier (MySQL allows `43_settings`)', () => {
    expect(sqlDotQualifier('select * from 43_settings s where s.')).toBe('s')
    expect(sqlDotQualifier('select 43_settings.')).toBe('43_settings')
  })
})

describe('sqlTableBindings', () => {
  it('binds FROM and JOIN tables with optional AS aliases', () => {
    const b = sqlTableBindings('select * from public.users pu join orders as o on o.user_id = pu.id')
    expect(b).toEqual([
      { ref: { schema: 'public', name: 'users' }, alias: 'pu' },
      { ref: { schema: null, name: 'orders' }, alias: 'o' }
    ])
  })

  it('does not mistake a clause keyword for an alias', () => {
    const b = sqlTableBindings('select * from users where id = 1')
    expect(b).toEqual([{ ref: { schema: null, name: 'users' }, alias: null }])
  })

  it('binds the joined table even when the preceding table has no alias', () => {
    // Regression: a consumed `join` once made the scan resume past it, dropping orders.
    const b = sqlTableBindings('select * from users join orders o on o.user_id = users.id')
    expect(b).toEqual([
      { ref: { schema: null, name: 'users' }, alias: null },
      { ref: { schema: null, name: 'orders' }, alias: 'o' }
    ])
  })

  it('binds every table in an unaliased join chain', () => {
    const b = sqlTableBindings('select * from a join b join c')
    expect(b.map((x) => x.ref.name)).toEqual(['a', 'b', 'c'])
  })

  it('binds a table whose name starts with a digit (MySQL `43_settings`)', () => {
    const b = sqlTableBindings('select * from 43_settings where id = 1')
    expect(b).toEqual([{ ref: { schema: null, name: '43_settings' }, alias: null }])
  })
})

describe('resolveSqlQualifier', () => {
  it('resolves an alias to its table, completing the schema from the object list', () => {
    const r = resolveSqlQualifier('select u. from users u', 'u', SQL_OBJECTS)
    expect(r).toEqual({ type: 'columns', ref: { schema: 'public', name: 'users' } })
  })

  it('resolves a schema-qualified binding', () => {
    const r = resolveSqlQualifier('select o. from sales.orders o', 'o', SQL_OBJECTS)
    expect(r).toEqual({ type: 'columns', ref: { schema: 'sales', name: 'orders' } })
  })

  it('resolves a bare table name used in FROM', () => {
    const r = resolveSqlQualifier('select users. from users', 'users', SQL_OBJECTS)
    expect(r).toEqual({ type: 'columns', ref: { schema: 'public', name: 'users' } })
  })

  it('resolves a schema name to its objects', () => {
    const r = resolveSqlQualifier('select * from ', 'sales', SQL_OBJECTS)
    expect(r).toEqual({ type: 'schemaObjects', schema: 'sales' })
  })

  it('resolves a known object name even without a FROM binding', () => {
    const r = resolveSqlQualifier('select orders.', 'orders', SQL_OBJECTS)
    expect(r).toEqual({ type: 'columns', ref: { schema: 'sales', name: 'orders' } })
  })

  it('is null for an unknown qualifier', () => {
    expect(resolveSqlQualifier('select x.', 'x', SQL_OBJECTS)).toBeNull()
  })

  it('matches case-insensitively', () => {
    const r = resolveSqlQualifier('select U. FROM Users U', 'U', SQL_OBJECTS)
    expect(r).toEqual({ type: 'columns', ref: { schema: 'public', name: 'users' } })
  })
})

describe('columnSuggestions / schemaObjectSuggestions', () => {
  it('maps columns with their data type as detail', () => {
    const sugs = columnSuggestions([{ name: 'id', dataType: 'integer', nullable: false }])
    expect(sugs).toEqual([{ label: 'id', kind: 'column', insertText: 'id', detail: 'integer' }])
  })

  it('lists only the objects of the given schema', () => {
    const sugs = schemaObjectSuggestions(SQL_OBJECTS, 'sales')
    expect(sugs.map((s) => s.label)).toEqual(['orders'])
  })
})

describe('sqlBoundRefs', () => {
  it('resolves FROM/JOIN tables to refs, labelled by alias then name', () => {
    const refs = sqlBoundRefs('select * from users u join sales.orders where ', SQL_OBJECTS)
    expect(refs).toEqual([
      { label: 'u', ref: { schema: 'public', name: 'users' } },
      { label: 'orders', ref: { schema: 'sales', name: 'orders' } }
    ])
  })

  it('is empty when the statement binds no tables', () => {
    expect(sqlBoundRefs('select ', SQL_OBJECTS)).toEqual([])
  })
})

describe('unqualifiedColumnSuggestions', () => {
  it('lists each table\'s columns with the table as detail', () => {
    const sugs = unqualifiedColumnSuggestions([
      { label: 'u', cols: [{ name: 'id', dataType: 'integer', nullable: false }, { name: 'email', dataType: 'text', nullable: true }] },
      { label: 'o', cols: [{ name: 'id', dataType: 'bigint', nullable: false }] }
    ])
    expect(sugs).toEqual([
      { label: 'id', kind: 'column', insertText: 'id', detail: 'u · integer' },
      { label: 'email', kind: 'column', insertText: 'email', detail: 'u · text' },
      { label: 'id', kind: 'column', insertText: 'id', detail: 'o · bigint' }
    ])
  })

  it('collapses exact (table, column) duplicates', () => {
    const sugs = unqualifiedColumnSuggestions([
      { label: 'u', cols: [{ name: 'id', dataType: 'integer', nullable: false }] },
      { label: 'u', cols: [{ name: 'id', dataType: 'integer', nullable: false }] }
    ])
    expect(sugs.map((s) => s.detail)).toEqual(['u · integer'])
  })
})

describe('mongoCursorContext', () => {
  it('classifies db. as default-db collections', () => {
    expect(mongoCursorContext('db.')).toEqual({ type: 'collections', database: null })
    expect(mongoCursorContext('db.us')).toEqual({ type: 'collections', database: null })
  })

  it('classifies db.coll. as ops', () => {
    expect(mongoCursorContext('db.users.')).toEqual({ type: 'ops' })
    expect(mongoCursorContext('db.users.fi')).toEqual({ type: 'ops' })
  })

  it('classifies an open getSiblingDB string as databases', () => {
    expect(mongoCursorContext('db.getSiblingDB("')).toEqual({ type: 'databases', partial: '' })
    expect(mongoCursorContext("db.getSiblingDB('ana")).toEqual({ type: 'databases', partial: 'ana' })
  })

  it('classifies getSiblingDB("x"). as collections of x', () => {
    expect(mongoCursorContext('db.getSiblingDB("analytics").')).toEqual({
      type: 'collections',
      database: 'analytics'
    })
  })

  it('classifies getSiblingDB("x").coll. as ops', () => {
    expect(mongoCursorContext('db.getSiblingDB("analytics").events.')).toEqual({ type: 'ops' })
  })

  it('anchors at the cursor, ignoring earlier statements', () => {
    expect(mongoCursorContext('db.users.find({}); db.ord')).toEqual({ type: 'collections', database: null })
  })

  it('classifies inside a query object as fields of that collection', () => {
    expect(mongoCursorContext('db.tickets.find({ ')).toEqual({ type: 'fields', collection: 'tickets', database: null })
    expect(mongoCursorContext('db.tickets.find({ us')).toEqual({ type: 'fields', collection: 'tickets', database: null })
    // still inside after an earlier key/value pair
    expect(mongoCursorContext('db.tickets.find({ status: "open", us')).toEqual({ type: 'fields', collection: 'tickets', database: null })
    // aggregate pipeline stage, and update's $set object
    expect(mongoCursorContext('db.orders.aggregate([{ ')).toEqual({ type: 'fields', collection: 'orders', database: null })
    expect(mongoCursorContext('db.users.updateOne({ }, { $set: { ')).toEqual({ type: 'fields', collection: 'users', database: null })
  })

  it('classifies fields inside a getSiblingDB collection query', () => {
    expect(mongoCursorContext('db.getSiblingDB("analytics").events.find({ ev')).toEqual({
      type: 'fields', collection: 'events', database: 'analytics'
    })
  })

  it('is null outside a completable spot', () => {
    expect(mongoCursorContext('select * from users')).toBeNull()
    expect(mongoCursorContext('foo.')).toBeNull()
    expect(mongoCursorContext('db.users.find({}).')).toBeNull() // chained cursor methods
    expect(mongoCursorContext('db.users.find(')).toBeNull() // opened call but no argument object yet
  })
})

describe('mongoCollectionSuggestions', () => {
  const DEFAULT_DB: DbObject[] = [
    { schema: null, name: 'users', kind: 'collection' },
    { schema: null, name: 'my-coll', kind: 'collection' } // not expressible as db.my-coll
  ]
  const BROWSE_ALL: DbObject[] = [
    { schema: 'app', name: 'users', kind: 'collection' },
    { schema: 'analytics', name: 'events', kind: 'collection' }
  ]

  it('lists identifier-safe default-db collections plus the getSiblingDB snippet', () => {
    const sugs = mongoCollectionSuggestions(DEFAULT_DB, null)
    expect(sugs.map((s) => s.label)).toEqual(['users', 'getSiblingDB'])
    expect(sugs[1].isSnippet).toBe(true)
  })

  it('offers only getSiblingDB on a browse-all connection (plain db.x would be refused)', () => {
    const sugs = mongoCollectionSuggestions(BROWSE_ALL, null)
    expect(sugs.map((s) => s.label)).toEqual(['getSiblingDB'])
  })

  it('lists a sibling database’s collections without the snippet', () => {
    const sugs = mongoCollectionSuggestions(BROWSE_ALL, 'analytics')
    expect(sugs).toEqual([
      { label: 'events', kind: 'collection', insertText: 'events', detail: 'analytics' }
    ])
  })
})

describe('mongoOpSuggestions', () => {
  it('offers every op as a snippet, tagged read/write', () => {
    const sugs = mongoOpSuggestions()
    const find = sugs.find((s) => s.label === 'find')
    expect(find).toEqual({ label: 'find', kind: 'op', insertText: 'find({ $0 })', isSnippet: true, detail: 'read' })
    const insertOne = sugs.find((s) => s.label === 'insertOne')
    expect(insertOne?.detail).toBe('write')
    expect(sugs).toHaveLength(13)
  })

  it('escapes literal $ in update snippets so $set survives snippet expansion', () => {
    const updateOne = mongoOpSuggestions().find((s) => s.label === 'updateOne')
    expect(updateOne?.insertText).toContain('\\$set')
  })
})

describe('mongoDatabaseSuggestions', () => {
  it('returns the distinct schema tags, skipping null', () => {
    const sugs = mongoDatabaseSuggestions([
      { schema: 'app', name: 'users', kind: 'collection' },
      { schema: 'app', name: 'sessions', kind: 'collection' },
      { schema: 'analytics', name: 'events', kind: 'collection' },
      { schema: null, name: 'local-only', kind: 'collection' }
    ])
    expect(sugs.map((s) => s.label)).toEqual(['app', 'analytics'])
  })
})
