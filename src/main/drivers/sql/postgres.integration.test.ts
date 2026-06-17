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
    const join = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT a.id, b.id AS bid FROM t_edit a, t_edit b' }, { maxRows: 10, queryId: 'e3', readOnly: false })
    expect(join.editable).toBeNull()
    // A self-join projecting DIFFERENT columns shows one source table in the metadata,
    // but one result row spans two base rows — must still be refused (no wrong-row write).
    const selfJoin = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT a.id, b.name FROM t_edit a JOIN t_edit b ON b.id = a.id' }, { maxRows: 10, queryId: 'e3b', readOnly: false })
    expect(selfJoin.editable).toBeNull()
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
})
