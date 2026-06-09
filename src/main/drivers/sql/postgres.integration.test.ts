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
})
