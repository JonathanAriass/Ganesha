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

  it('listDatabases returns user databases, excluding system ones', async () => {
    const dbs = await driver.listDatabases(id)
    expect(dbs).toContain(container.getDatabase())
    expect(dbs).not.toContain('information_schema')
    expect(dbs).not.toContain('performance_schema')
  })

  it('a single-table SELECT reports an editable descriptor', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE t_edit (id INT PRIMARY KEY, name VARCHAR(50))' }, { maxRows: 1000, queryId: 'me0', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO t_edit VALUES (1,'a'),(2,'b')" }, { maxRows: 1000, queryId: 'me1', readOnly: false })
    const sel = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT id, name FROM t_edit' }, { maxRows: 10, queryId: 'me2', readOnly: false })
    expect(sel.editable).toEqual({ table: { schema: container.getDatabase(), name: 't_edit' }, keyColumns: ['id'], columnSources: ['id', 'name'] })
  })

  it('applyEdits updates by primary key', async () => {
    const r = await driver.applyEdits(id, { table: { schema: container.getDatabase(), name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'A' } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT name FROM t_edit WHERE id=1' }, { maxRows: 10, queryId: 'me3', readOnly: false })
    expect(after.rows).toEqual([['A']])
  })

  it('applyEdits rolls back when a row key matches nothing', async () => {
    await expect(
      driver.applyEdits(id, { table: { schema: container.getDatabase(), name: 't_edit' }, rows: [
        { key: { id: 2 }, set: { name: 'B' } },
        { key: { id: 999 }, set: { name: 'X' } }
      ] }, { readOnly: false })
    ).rejects.toThrow(/affected 0 rows|expected exactly one/i)
    const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT name FROM t_edit WHERE id=2' }, { maxRows: 10, queryId: 'me4', readOnly: false })
    expect(after.rows).toEqual([['b']])
  })

  it('applyEdits refuses on read-only', async () => {
    await expect(
      driver.applyEdits(id, { table: { schema: container.getDatabase(), name: 't_edit' }, rows: [{ key: { id: 1 }, set: { name: 'z' } }] }, { readOnly: true })
    ).rejects.toThrow(/read-only/i)
  })

  // The renderer can only display/edit a string; a JS Date renders as quoted ISO, which mysql
  // rejects ("Incorrect datetime value") when bound back. Timestamps must arrive as strings.
  it('returns datetimes as strings that round-trip through applyEdits', async () => {
    const db = container.getDatabase()
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE t_ts (id INT PRIMARY KEY, ts DATETIME, d DATE)' }, { maxRows: 10, queryId: 'mt0', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO t_ts VALUES (1, '2026-06-22 08:30:00', '2026-06-22')" }, { maxRows: 10, queryId: 'mt1', readOnly: false })
    const got = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT ts, d FROM t_ts WHERE id=1' }, { maxRows: 10, queryId: 'mt2', readOnly: false })
    const [ts, d] = got.rows[0] as [unknown, unknown]
    expect(typeof ts).toBe('string')
    expect(typeof d).toBe('string')
    const r = await driver.applyEdits(id, { table: { schema: db, name: 't_ts' }, rows: [{ key: { id: 1 }, set: { ts, d } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'sql', sql: 'SELECT ts, d FROM t_ts WHERE id=1' }, { maxRows: 10, queryId: 'mt3', readOnly: false })
    expect(after.rows[0]).toEqual([ts, d])
  })

  it('listRelationships returns declared foreign keys (single-database scope, schema null)', async () => {
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_parent (id INT PRIMARY KEY) ENGINE=InnoDB' }, { maxRows: 10, queryId: 'mfk0', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES rel_parent(id)) ENGINE=InnoDB' }, { maxRows: 10, queryId: 'mfk1', readOnly: false })
    // Composite FK (KEY_COLUMN_USAGE pairs per row, so both column pairs come back correctly).
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_pk2 (a INT, b INT, PRIMARY KEY (a, b)) ENGINE=InnoDB' }, { maxRows: 10, queryId: 'mfk2', readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE rel_fk2 (x INT, y INT, KEY (x, y), FOREIGN KEY (x, y) REFERENCES rel_pk2 (a, b)) ENGINE=InnoDB' }, { maxRows: 10, queryId: 'mfk3', readOnly: false })

    const rels = await driver.listRelationships(id)
    // Single-database scope → schema is null (matching listObjects).
    expect(rels).toContainEqual({
      fromSchema: null, fromTable: 'rel_child', fromColumn: 'parent_id',
      toSchema: null, toTable: 'rel_parent', toColumn: 'id', origin: 'declared'
    })
    expect(rels).toContainEqual({ fromSchema: null, fromTable: 'rel_fk2', fromColumn: 'x', toSchema: null, toTable: 'rel_pk2', toColumn: 'a', origin: 'declared' })
    expect(rels).toContainEqual({ fromSchema: null, fromTable: 'rel_fk2', fromColumn: 'y', toSchema: null, toTable: 'rel_pk2', toColumn: 'b', origin: 'declared' })
    expect(rels.every((r) => r.origin === 'declared')).toBe(true)
  })

  it('describeTableInfo returns columns, indexes, FKs (out + in), constraints, and size', async () => {
    const opt = (q: string) => ({ maxRows: 1000, queryId: q, readOnly: false })
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE ti_parent (id INT PRIMARY KEY, code VARCHAR(20) UNIQUE) ENGINE=InnoDB' }, opt('ti0'))
    await driver.runQuery(id, { kind: 'sql', sql:
      `CREATE TABLE ti_main (
         id INT PRIMARY KEY, email VARCHAR(100) NOT NULL, status VARCHAR(20) DEFAULT 'active',
         parent_id INT, FOREIGN KEY (parent_id) REFERENCES ti_parent(id),
         CONSTRAINT ti_email_chk CHECK (email <> '')) ENGINE=InnoDB` }, opt('ti1'))
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE UNIQUE INDEX ti_email_uq ON ti_main (email)' }, opt('ti2'))
    await driver.runQuery(id, { kind: 'sql', sql: 'CREATE TABLE ti_child (id INT PRIMARY KEY, main_id INT, FOREIGN KEY (main_id) REFERENCES ti_main(id)) ENGINE=InnoDB' }, opt('ti3'))
    await driver.runQuery(id, { kind: 'sql', sql: "INSERT INTO ti_main VALUES (1,'a@b.com','active',NULL),(2,'c@d.com','active',NULL)" }, opt('ti4'))

    const info = await driver.describeTableInfo(id, { schema: null, name: 'ti_main' })

    expect(info.columns.find((c) => c.name === 'id')).toMatchObject({ primaryKey: true, nullable: false })
    expect(info.columns.find((c) => c.name === 'status')).toMatchObject({ nullable: true, primaryKey: false, default: expect.stringContaining('active') })

    expect(info.indexes).toContainEqual(expect.objectContaining({ name: 'PRIMARY', columns: ['id'], unique: true, primary: true }))
    expect(info.indexes).toContainEqual(expect.objectContaining({ name: 'ti_email_uq', columns: ['email'], unique: true, primary: false }))

    expect(info.foreignKeys).toContainEqual(expect.objectContaining({ columns: ['parent_id'], refSchema: null, refTable: 'ti_parent', refColumns: ['id'] }))
    expect(info.referencedBy).toContainEqual(expect.objectContaining({ refTable: 'ti_child', refColumns: ['main_id'], columns: ['id'] }))

    expect(info.constraints.some((c) => c.type === 'check' && c.name === 'ti_email_chk')).toBe(true)
    expect(typeof info.size?.bytes).toBe('number')
  })
})
