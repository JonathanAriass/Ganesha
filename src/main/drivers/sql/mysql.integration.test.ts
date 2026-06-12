import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { MySqlDriver } from './mysql'

describe('MySqlDriver (integration, requires Docker)', () => {
  let container: StartedMySqlContainer
  const driver = new MySqlDriver('mysql')
  const id = 'itest'

  beforeAll(async () => {
    container = await new MySqlContainer('mysql:8').start()
    await driver.connect({
      id,
      type: 'mysql',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getUserPassword(),
      database: container.getDatabase(),
      ssl: false
    })
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
    expect(res.truncated).toBe(false)
    expect(res.documents).toBeNull()
  })

  it('caps rows at maxRows and flags truncated', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE nums (n INT)' }, { maxRows: 1000, queryId: 'q2', readOnly: false })
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'INSERT INTO nums VALUES (1),(2),(3),(4),(5)' },
      { maxRows: 1000, queryId: 'q3', readOnly: false }
    )
    const res = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT n FROM nums ORDER BY n' }, { maxRows: 2, queryId: 'q4', readOnly: false })
    expect(res.rows.length).toBe(2)
    expect(res.truncated).toBe(true)
  })

  it('enforces read-only at the SERVER (blocks a write)', async () => {
    await expect(
      driver.runQuery(id, { kind: 'sql', sql: 'INSERT INTO nums VALUES (99)' }, { maxRows: 1000, queryId: 'q5', readOnly: true })
    ).rejects.toThrow(/read[- ]?only/i)
  })

  it('returns BIGINT exactly: native number while safe, digit string past 2^53', async () => {
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'CREATE TABLE fidelity (big BIGINT, price DECIMAL(20, 6))' },
      { maxRows: 1000, queryId: 'q7', readOnly: false }
    )
    const ins = await driver.runQuery(
      id,
      // 9007199254740993 = 2^53 + 1: the default Number decode would silently read it as …992.
      { kind: 'sql', sql: 'INSERT INTO fidelity VALUES (42, 0.1), (9007199254740993, 1234567890123.456789)' },
      { maxRows: 1000, queryId: 'q8', readOnly: false }
    )
    expect(ins.rowCount).toBe(2) // affectedRows survives the defensive Number() coercion

    const res = await driver.runQuery(
      id,
      { kind: 'sql', sql: 'SELECT big, price FROM fidelity ORDER BY big' },
      { maxRows: 1000, queryId: 'q9', readOnly: false }
    )
    expect(res.rows).toEqual([
      [42, '0.100000'], // DECIMAL is always an exact string (mysql2 default)
      ['9007199254740993', '1234567890123.456789']
    ])
  })

  it('listObjects and describeObject return correct schema metadata', async () => {
    await driver.runQuery(
      id,
      { kind: 'sql', sql: 'CREATE TABLE t_intro (a int NOT NULL, b text)' },
      { maxRows: 1000, queryId: 'q6', readOnly: false }
    )
    const objects = await driver.listObjects(id)
    expect(objects).toContainEqual({ schema: null, name: 't_intro', kind: 'table' })

    const columns = await driver.describeObject(id, { schema: null, name: 't_intro' })
    expect(columns).toEqual([
      { name: 'a', dataType: 'int', nullable: false },
      { name: 'b', dataType: 'text', nullable: true }
    ])
  })
})
