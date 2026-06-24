import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PostgresDriver } from './postgres'
import type { ConnectParams } from '../types'

describe('PostgresDriver (integration, requires Docker)', () => {
  let container: StartedPostgreSqlContainer
  const driver = new PostgresDriver()
  const id = 'itest'

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
    const params: ConnectParams = {
      id,
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
      ssl: false
    }
    await driver.connect(params)
  })

  afterAll(async () => {
    await driver.disconnect(id)
    await container?.stop()
  })

  it('runs a SELECT and returns a normalized, column-aligned result', async () => {
    const res = await driver.runQuery(
      id,
      { kind: 'sql', sql: "SELECT 1 AS n, 'hi' AS s" },
      { maxRows: 1000, queryId: 'q1', readOnly: false }
    )
    expect(res.columns.map((c) => c.name)).toEqual(['n', 's'])
    expect(res.rows).toEqual([[1, 'hi']])
    expect(res.rowCount).toBe(1)
    expect(res.truncated).toBe(false)
    expect(res.documents).toBeNull()
  })

  it('caps rows at maxRows and flags truncated', async () => {
    const res = await driver.runQuery(
      id,
      { kind: 'sql', sql: 'SELECT generate_series(1, 100) AS n' },
      { maxRows: 10, queryId: 'q2', readOnly: false }
    )
    expect(res.rows.length).toBe(10)
    expect(res.truncated).toBe(true)
  })

  it('enforces read-only at the SERVER (blocks a write even past the upstream guard)', async () => {
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'CREATE TABLE t_ro (id int)' },
      { maxRows: 1000, queryId: 'q3', readOnly: false }
    )
    await expect(
      driver.runQuery(
        id,
        { kind: 'sql', sql: 'INSERT INTO t_ro VALUES (1)' },
        { maxRows: 1000, queryId: 'q4', readOnly: true }
      )
    ).rejects.toThrow(/read-only transaction/i)
  })

  it('listObjects and describeObject return correct schema metadata', async () => {
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'CREATE TABLE t_intro (a int NOT NULL, b text)' },
      { maxRows: 1000, queryId: 'q5', readOnly: false }
    )
    const objects = await driver.listObjects(id)
    expect(objects).toContainEqual({ schema: 'public', name: 't_intro', kind: 'table' })

    const columns = await driver.describeObject(id, { schema: 'public', name: 't_intro' })
    expect(columns).toEqual([
      { name: 'a', dataType: 'integer', nullable: false },
      { name: 'b', dataType: 'text', nullable: true }
    ])
  })

  it('listDatabases returns user schemas, excluding system ones', async () => {
    const dbs = await driver.listDatabases(id)
    expect(dbs).toContain('public')
    expect(dbs).not.toContain('pg_catalog')
    expect(dbs).not.toContain('information_schema')
  })

  it('a single-table SELECT * reports an editable descriptor; a join does not', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE t_edit (id int PRIMARY KEY, name text)' }, { maxRows: 1000, queryId: 'e0', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO t_edit VALUES (1,'a'),(2,'b')" }, { maxRows: 1000, queryId: 'e1', readOnly: false })
    const sel = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT * FROM t_edit ORDER BY id' }, { maxRows: 10, queryId: 'e2', readOnly: false })
    expect(sel.editable).toEqual({ table: { schema: 'public', name: 't_edit' }, keyColumns: ['id'], columnSources: ['id', 'name'] })
    // A table-qualified select list (`t_edit.id`) must stay editable — the qualifier is
    // not a second table reference.
    const qualified = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT t_edit.id, t_edit.name FROM t_edit' }, { maxRows: 10, queryId: 'e2b', readOnly: false })
    expect(qualified.editable).toEqual({ table: { schema: 'public', name: 't_edit' }, keyColumns: ['id'], columnSources: ['id', 'name'] })
    const join = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT a.id, b.id AS bid FROM t_edit a, t_edit b' }, { maxRows: 10, queryId: 'e3', readOnly: false })
    expect(join.editable).toBeNull()
    // A self-join projecting DIFFERENT columns shows one source table in the metadata,
    // but one result row spans two base rows — must still be refused (no wrong-row write).
    const selfJoin = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT a.id, b.name FROM t_edit a JOIN t_edit b ON b.id = a.id' }, { maxRows: 10, queryId: 'e3b', readOnly: false })
    expect(selfJoin.editable).toBeNull()
    // pg reports tableID provenance to the base table even through a CTE / derived table,
    // so these self-joins also look single-table by metadata — must be refused too.
    const cte = await driver.runQuery(id, { kind: 'sql', sql: 'WITH c AS (SELECT * FROM t_edit) SELECT a.id, b.name FROM c a JOIN c b ON b.id = a.id' }, { maxRows: 10, queryId: 'e3c', readOnly: false })
    expect(cte.editable).toBeNull()
    const derived = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT x.id, y.name FROM (SELECT * FROM t_edit WHERE id > 0) x JOIN t_edit y ON y.id = x.id' }, { maxRows: 10, queryId: 'e3d', readOnly: false })
    expect(derived.editable).toBeNull()
    // A parenthesis-wrapped CTE is a valid top-level statement — must not bypass the guard.
    const parenCte = await driver.runQuery(id, { kind: 'sql', sql: '(WITH c AS (SELECT * FROM t_edit) SELECT a.id, b.name FROM c a JOIN c b ON b.id = a.id)' }, { maxRows: 10, queryId: 'e3e', readOnly: false })
    expect(parenCte.editable).toBeNull()
    // A leading semicolon must not smuggle a CTE past a start-anchored guard either.
    const semiCte = await driver.runQuery(id, { kind: 'sql', sql: ';WITH c AS (SELECT * FROM t_edit) SELECT a.id, b.name FROM c a JOIN c b ON b.id = a.id' }, { maxRows: 10, queryId: 'e3f', readOnly: false })
    expect(semiCte.editable).toBeNull()
  })

  it('applyEdits updates by primary key in a transaction', async () => {
    const r = await driver.applyEdits(id, { table: { schema: 'public', name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'A' } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT name FROM t_edit WHERE id=1' }, { maxRows: 10, queryId: 'e4', readOnly: false })
    expect(after.rows).toEqual([['A']])
  })

  it('applyEdits rolls back the whole batch when a row key matches nothing', async () => {
    await expect(
      driver.applyEdits(id, { table: { schema: 'public', name: 't_edit' }, rows: [
        { key: { id: 2 }, set: { name: 'B' } },
        { key: { id: 999 }, set: { name: 'X' } }
      ] }, { readOnly: false })
    ).rejects.toThrow(/affected 0 rows|expected exactly one/i)
    const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT name FROM t_edit WHERE id=2' }, { maxRows: 10, queryId: 'e5', readOnly: false })
    expect(after.rows).toEqual([['b']]) // first update rolled back
  })

  it('applyEdits refuses on a read-only request', async () => {
    await expect(
      driver.applyEdits(id, { table: { schema: 'public', name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'z' } }] }, { readOnly: true })
    ).rejects.toThrow(/read-only/i)
  })

  // The renderer can only display/edit a string; a JS Date renders as quoted ISO ("…Z"),
  // which the DB rejects when bound back. So timestamps must arrive as round-trippable strings.
  it('returns timestamps/intervals as strings that round-trip through applyEdits', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE t_ts (id int PRIMARY KEY, ts timestamp, tz timestamptz, iv interval)' }, { maxRows: 10, queryId: 't0', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO t_ts VALUES (1, '2026-06-22 08:30:00', '2026-06-22 08:30:00+00', '1 year 2 mons 3 days')" }, { maxRows: 10, queryId: 't1', readOnly: false })
    const got = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT ts, tz, iv FROM t_ts WHERE id=1' }, { maxRows: 10, queryId: 't2', readOnly: false })
    const [ts, tz, iv] = got.rows[0] as [unknown, unknown, unknown]
    // interval defaults to a PostgresInterval OBJECT — must be returned as text too, else the
    // renderer JSON-stringifies it and the bind fails just like a Date.
    expect([typeof ts, typeof tz, typeof iv]).toEqual(['string', 'string', 'string'])
    // Committing the edited (same) displayed value must succeed and persist unchanged.
    const r = await driver.applyEdits(id, { table: { schema: 'public', name: 't_ts' }, rows: [{ key: { id: 1 }, set: { ts, tz, iv } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT ts, tz, iv FROM t_ts WHERE id=1' }, { maxRows: 10, queryId: 't3', readOnly: false })
    expect(after.rows[0]).toEqual([ts, tz, iv])
  })

  it('listRelationships returns declared foreign keys, pairing composite keys in order', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_parent (id int PRIMARY KEY)' }, { maxRows: 10, queryId: 'fk0', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_child (id int PRIMARY KEY, parent_id int REFERENCES rel_parent(id))' }, { maxRows: 10, queryId: 'fk1', readOnly: false })
    // Composite FK — the `unnest WITH ORDINALITY` pairing must keep (x→a, y→b), never cross-pair.
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_pk2 (a int, b int, PRIMARY KEY (a, b))' }, { maxRows: 10, queryId: 'fk2', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_fk2 (x int, y int, FOREIGN KEY (x, y) REFERENCES rel_pk2 (a, b))' }, { maxRows: 10, queryId: 'fk3', readOnly: false })

    const rels = await driver.listRelationships(id)
    expect(rels).toContainEqual({
      fromSchema: 'public', fromTable: 'rel_child', fromColumn: 'parent_id',
      toSchema: 'public', toTable: 'rel_parent', toColumn: 'id', origin: 'declared'
    })
    // Composite pairs, correctly ordered…
    expect(rels).toContainEqual({ fromSchema: 'public', fromTable: 'rel_fk2', fromColumn: 'x', toSchema: 'public', toTable: 'rel_pk2', toColumn: 'a', origin: 'declared' })
    expect(rels).toContainEqual({ fromSchema: 'public', fromTable: 'rel_fk2', fromColumn: 'y', toSchema: 'public', toTable: 'rel_pk2', toColumn: 'b', origin: 'declared' })
    // …and NOT cross-paired (the information_schema gotcha the WITH ORDINALITY query avoids).
    expect(rels).not.toContainEqual({ fromSchema: 'public', fromTable: 'rel_fk2', fromColumn: 'x', toSchema: 'public', toTable: 'rel_pk2', toColumn: 'b', origin: 'declared' })
    // The catalog read yields declared FKs only (inference is a separate renderer-side step).
    expect(rels.every((r) => r.origin === 'declared')).toBe(true)
  })
})
