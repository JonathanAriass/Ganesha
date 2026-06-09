import { describe, it, expect } from 'vitest'
import { isSqlReadOnly, assertSqlWritable, splitStatements } from './readonly-guard'

describe('splitStatements', () => {
  it('strips comments and splits on semicolons', () => {
    expect(splitStatements('SELECT 1; -- c\n SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
    expect(splitStatements('/* x */ SELECT 1')).toEqual(['SELECT 1'])
    expect(splitStatements('   ;  ')).toEqual([])
  })
})

describe('isSqlReadOnly', () => {
  it('allows pure reads', () => {
    expect(isSqlReadOnly('SELECT * FROM users')).toBe(true)
    expect(isSqlReadOnly('  select 1  ')).toBe(true)
    expect(isSqlReadOnly('SHOW TABLES')).toBe(true)
    expect(isSqlReadOnly('EXPLAIN SELECT * FROM t')).toBe(true)
    expect(isSqlReadOnly('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true)
    expect(isSqlReadOnly('SELECT 1; SELECT 2;')).toBe(true)
  })

  it('blocks writes and DDL', () => {
    expect(isSqlReadOnly('INSERT INTO t VALUES (1)')).toBe(false)
    expect(isSqlReadOnly('UPDATE t SET a=1')).toBe(false)
    expect(isSqlReadOnly('DELETE FROM t')).toBe(false)
    expect(isSqlReadOnly('DROP TABLE t')).toBe(false)
    expect(isSqlReadOnly('TRUNCATE t')).toBe(false)
    expect(isSqlReadOnly('SELECT 1; DELETE FROM t')).toBe(false)
    expect(isSqlReadOnly('SELECT * INTO new_table FROM users')).toBe(false)
  })

  it('blocks data-modifying CTEs and EXPLAIN ANALYZE (they execute writes)', () => {
    expect(isSqlReadOnly('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x')).toBe(false)
    expect(isSqlReadOnly('EXPLAIN ANALYZE DELETE FROM t')).toBe(false)
  })

  it('blocks unrecognized leading keywords (conservative)', () => {
    expect(isSqlReadOnly('GRANT ALL ON t TO bob')).toBe(false)
    expect(isSqlReadOnly('')).toBe(true) // empty is harmless
  })
})

describe('assertSqlWritable', () => {
  it('throws only when read-only and the sql writes', () => {
    expect(() => assertSqlWritable('DELETE FROM t', false)).not.toThrow()
    expect(() => assertSqlWritable('SELECT 1', true)).not.toThrow()
    expect(() => assertSqlWritable('DELETE FROM t', true)).toThrow(/read-only/i)
  })
})
