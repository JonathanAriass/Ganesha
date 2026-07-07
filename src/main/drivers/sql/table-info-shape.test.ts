import { describe, it, expect } from 'vitest'
import { groupIndexes, groupForeignKeys } from './table-info-shape'

describe('groupIndexes', () => {
  it('folds per-column rows into one index per name, columns in `ord` order', () => {
    const rows = [
      { name: 'users_pkey', column: 'id', unique: true, primary: true, method: 'btree', ord: 1 },
      { name: 'idx_name_email', column: 'name', unique: false, primary: false, method: 'btree', ord: 1 },
      { name: 'idx_name_email', column: 'email', unique: false, primary: false, method: 'btree', ord: 2 },
    ]
    expect(groupIndexes(rows)).toEqual([
      { name: 'users_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' },
      { name: 'idx_name_email', columns: ['name', 'email'], unique: false, primary: false, method: 'btree' },
    ])
  })

  it('orders columns by `ord` even if the rows arrive shuffled', () => {
    const rows = [
      { name: 'ix', column: 'b', unique: false, primary: false, method: null, ord: 2 },
      { name: 'ix', column: 'a', unique: false, primary: false, method: null, ord: 1 },
    ]
    expect(groupIndexes(rows)[0].columns).toEqual(['a', 'b'])
  })

  it('empty input → empty', () => {
    expect(groupIndexes([])).toEqual([])
  })
})

describe('groupForeignKeys', () => {
  it('folds per-column rows into one FK per name; columns align with refColumns', () => {
    const rows = [
      { name: 'fk_company', column: 'company_id', refSchema: 'public', refTable: 'companies', refColumn: 'id', ord: 1 },
    ]
    expect(groupForeignKeys(rows)).toEqual([
      { name: 'fk_company', columns: ['company_id'], refSchema: 'public', refTable: 'companies', refColumns: ['id'] },
    ])
  })

  it('keeps composite-key columns paired in order', () => {
    const rows = [
      { name: 'fk2', column: 'x', refSchema: null, refTable: 't', refColumn: 'a', ord: 1 },
      { name: 'fk2', column: 'y', refSchema: null, refTable: 't', refColumn: 'b', ord: 2 },
    ]
    expect(groupForeignKeys(rows)).toEqual([
      { name: 'fk2', columns: ['x', 'y'], refSchema: null, refTable: 't', refColumns: ['a', 'b'] },
    ])
  })

  it('groups multiple FKs, ordering columns by `ord` within each', () => {
    const rows = [
      { name: 'fkA', column: 'a', refSchema: null, refTable: 't1', refColumn: 'id', ord: 1 },
      { name: 'fkB', column: 'b2', refSchema: null, refTable: 't2', refColumn: 'q', ord: 2 },
      { name: 'fkB', column: 'b1', refSchema: null, refTable: 't2', refColumn: 'p', ord: 1 },
    ]
    expect(groupForeignKeys(rows).find((f) => f.name === 'fkB')).toEqual({
      name: 'fkB', columns: ['b1', 'b2'], refSchema: null, refTable: 't2', refColumns: ['p', 'q'],
    })
  })

  it('empty input → empty', () => {
    expect(groupForeignKeys([])).toEqual([])
  })
})
