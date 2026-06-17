import { describe, it, expect } from 'vitest'
import { buildUpdate } from './update-builder'

const T = { schema: 'public', name: 'users' }

describe('buildUpdate (postgres)', () => {
  it('builds a parameterized UPDATE with $n placeholders and quoted identifiers', () => {
    const r = buildUpdate('postgres', T, { key: { id: 7 }, set: { name: 'Ann', email: 'a@x.io' } })
    expect(r.sql).toBe('UPDATE "public"."users" SET "name" = $1, "email" = $2 WHERE "id" = $3')
    expect(r.params).toEqual(['Ann', 'a@x.io', 7])
  })
  it('uses IS NULL for a null key value (never = NULL)', () => {
    const r = buildUpdate('postgres', T, { key: { id: 7, tenant: null }, set: { v: 1 } })
    expect(r.sql).toBe('UPDATE "public"."users" SET "v" = $1 WHERE "id" = $2 AND "tenant" IS NULL')
    expect(r.params).toEqual([1, 7])
  })
  it('binds a null SET value as a parameter (sets the column NULL)', () => {
    const r = buildUpdate('postgres', T, { key: { id: 7 }, set: { note: null } })
    expect(r.sql).toBe('UPDATE "public"."users" SET "note" = $1 WHERE "id" = $2')
    expect(r.params).toEqual([null, 7])
  })
  it('omits the schema when null', () => {
    const r = buildUpdate('postgres', { schema: null, name: 't' }, { key: { id: 1 }, set: { v: 2 } })
    expect(r.sql).toBe('UPDATE "t" SET "v" = $1 WHERE "id" = $2')
  })
})

describe('buildUpdate (mysql)', () => {
  it('uses ? placeholders and backtick identifiers', () => {
    const r = buildUpdate('mysql', { schema: 'app', name: 'users' }, { key: { id: 7 }, set: { name: 'Ann' } })
    expect(r.sql).toBe('UPDATE `app`.`users` SET `name` = ? WHERE `id` = ?')
    expect(r.params).toEqual(['Ann', 7])
  })
  it('escapes embedded backtick characters in identifiers', () => {
    const r = buildUpdate('mysql', { schema: null, name: 'we`ird' }, { key: { id: 1 }, set: { 'c`ol': 2 } })
    expect(r.sql).toBe('UPDATE `we``ird` SET `c``ol` = ? WHERE `id` = ?')
  })
  it('throws when there are no SET columns', () => {
    expect(() => buildUpdate('mysql', T, { key: { id: 1 }, set: {} })).toThrow(/no columns/i)
  })
  it('throws when there are no key columns', () => {
    expect(() => buildUpdate('mysql', T, { key: {}, set: { v: 1 } })).toThrow(/no key/i)
  })
})
