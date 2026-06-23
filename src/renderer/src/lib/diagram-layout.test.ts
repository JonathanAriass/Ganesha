import { describe, it, expect } from 'vitest'
import { layoutDiagram, nodeHeight, NODE_WIDTH } from './diagram-layout'
import { buildDiagram, nodeKey } from './schema-diagram'
import type { ColumnInfo, DbObject, Relationship } from '@shared/schema'

const objects: DbObject[] = [
  { schema: null, name: 'a', kind: 'table' },
  { schema: null, name: 'b', kind: 'table' },
]
const columnsByTable = new Map<string, ColumnInfo[]>([
  [nodeKey(null, 'a'), [{ name: 'id', dataType: 'int', nullable: false }, { name: 'b_id', dataType: 'int', nullable: true }]],
  [nodeKey(null, 'b'), [{ name: 'id', dataType: 'int', nullable: false }]],
])
const rels: Relationship[] = [
  { fromSchema: null, fromTable: 'a', fromColumn: 'b_id', toSchema: null, toTable: 'b', toColumn: 'id', origin: 'declared' },
]
const diagram = buildDiagram(objects, columnsByTable, rels)

describe('layoutDiagram', () => {
  it('positions every node with a finite box, height sized by column count', () => {
    const laid = layoutDiagram(diagram)
    expect(laid.nodes).toHaveLength(2)
    for (const n of laid.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
      expect(n.width).toBe(NODE_WIDTH)
      expect(n.height).toBe(nodeHeight(n))
    }
    expect(laid.width).toBeGreaterThan(0)
    expect(laid.height).toBeGreaterThan(0)
  })
  it('routes each edge with at least two points', () => {
    const laid = layoutDiagram(diagram)
    expect(laid.edges).toHaveLength(1)
    expect(laid.edges[0].points.length).toBeGreaterThanOrEqual(2)
  })
  it('is deterministic for the same input', () => {
    const a = layoutDiagram(diagram)
    const b = layoutDiagram(diagram)
    expect(b.nodes.map((n) => [n.x, n.y])).toEqual(a.nodes.map((n) => [n.x, n.y]))
  })
})
