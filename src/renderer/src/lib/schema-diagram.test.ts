import { describe, it, expect } from 'vitest'
import type { ColumnInfo, DbObject, Relationship } from '@shared/schema'
import { inferRelationships, mergeRelationships, buildDiagram, nodeKey } from './schema-diagram'

const tbl = (name: string): DbObject => ({ schema: null, name, kind: 'table' })
const col = (name: string): ColumnInfo => ({ name, dataType: 'int', nullable: true })
const cols = (...names: string[]): ColumnInfo[] => names.map(col)

const objects = [tbl('01_companies'), tbl('02_users'), tbl('03_companies_users'), tbl('04_roles')]
const columnsByTable = new Map<string, ColumnInfo[]>([
  [nodeKey(null, '01_companies'), cols('id', 'name')],
  [nodeKey(null, '02_users'), cols('id', 'email', 'company_id', 'manager_id')],
  [nodeKey(null, '03_companies_users'), cols('id', 'company_id', 'user_id', 'id_role')],
  [nodeKey(null, '04_roles'), cols('id', 'name')],
])

describe('inferRelationships', () => {
  const inferred = inferRelationships(objects, columnsByTable)
  const has = (from: string, col: string, to: string): boolean =>
    inferred.some((r) => r.fromTable === from && r.fromColumn === col && r.toTable === to && r.origin === 'inferred')

  it('maps NN_-prefixed FK columns to their table (company_id → 01_companies, id_role → 04_roles)', () => {
    expect(has('03_companies_users', 'company_id', '01_companies')).toBe(true)
    expect(has('03_companies_users', 'user_id', '02_users')).toBe(true)
    expect(has('03_companies_users', 'id_role', '04_roles')).toBe(true)
    expect(has('02_users', 'company_id', '01_companies')).toBe(true)
  })
  it('ignores columns that resolve to no table (manager_id has no `managers` table)', () => {
    expect(inferred.some((r) => r.fromColumn === 'manager_id')).toBe(false)
  })
  it('never emits a self-loop', () => {
    expect(inferred.every((r) => !(r.fromTable === r.toTable))).toBe(true)
  })
})

describe('mergeRelationships', () => {
  const declared: Relationship[] = [{
    fromSchema: null, fromTable: '02_users', fromColumn: 'company_id',
    toSchema: null, toTable: '01_companies', toColumn: 'id', origin: 'declared'
  }]
  it('keeps a declared FK and drops the inferred edge on the same column', () => {
    const inferred = inferRelationships(objects, columnsByTable)
    const merged = mergeRelationships(declared, inferred)
    const usersCompany = merged.filter((r) => r.fromTable === '02_users' && r.fromColumn === 'company_id')
    expect(usersCompany).toHaveLength(1)
    expect(usersCompany[0].origin).toBe('declared')
  })
  it('adds inferred edges that have no declared counterpart', () => {
    const merged = mergeRelationships(declared, inferRelationships(objects, columnsByTable))
    expect(merged.some((r) => r.fromTable === '03_companies_users' && r.origin === 'inferred')).toBe(true)
  })
})

describe('buildDiagram', () => {
  const rels = mergeRelationships([], inferRelationships(objects, columnsByTable))
  const diagram = buildDiagram(objects, columnsByTable, rels)

  it('makes one node per table, marking PK (id) and FK columns', () => {
    expect(diagram.nodes).toHaveLength(4)
    const cu = diagram.nodes.find((n) => n.name === '03_companies_users')!
    expect(cu.columns.find((c) => c.name === 'id')!.isPk).toBe(true)
    expect(cu.columns.find((c) => c.name === 'company_id')!.isFk).toBe(true)
    expect(cu.columns.find((c) => c.name === 'company_id')!.isPk).toBe(false)
  })
  it('emits edges only between known tables, never self-loops', () => {
    expect(diagram.edges.length).toBeGreaterThan(0)
    expect(diagram.edges.every((e) => e.from !== e.to)).toBe(true)
    for (const e of diagram.edges) {
      expect(diagram.nodes.some((n) => n.id === e.from)).toBe(true)
      expect(diagram.nodes.some((n) => n.id === e.to)).toBe(true)
    }
  })
  it('drops an edge whose referenced table is not in the object list', () => {
    const dangling: Relationship[] = [{
      fromSchema: null, fromTable: '02_users', fromColumn: 'ghost_id',
      toSchema: null, toTable: '99_ghost', toColumn: 'id', origin: 'inferred'
    }]
    expect(buildDiagram(objects, columnsByTable, dangling).edges).toHaveLength(0)
  })
})
