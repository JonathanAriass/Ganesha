import dagre from '@dagrejs/dagre'
import type { Diagram, DiagramNode, DiagramEdge } from './schema-diagram'

export const NODE_WIDTH = 220
export const HEADER_H = 28
export const ROW_H = 18

/** Box height for a table node: header + one row per column (min one). */
export function nodeHeight(node: DiagramNode): number {
  return HEADER_H + Math.max(node.columns.length, 1) * ROW_H
}

export interface LaidNode extends DiagramNode {
  x: number
  y: number
  width: number
  height: number
}
export interface LaidEdge extends DiagramEdge {
  points: { x: number; y: number }[]
}
export interface LaidDiagram {
  nodes: LaidNode[]
  edges: LaidEdge[]
  width: number
  height: number
}

/** Auto-layout the diagram with dagre (left-to-right layered). Returns top-left node positions (dagre
 *  gives centres) plus routed edge point-lists and the overall canvas size. Deterministic. */
export function layoutDiagram(diagram: Diagram): LaidDiagram {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 90, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of diagram.nodes) g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n) })
  // Multigraph + per-edge name: a pair of tables can be joined by more than one FK column.
  for (const e of diagram.edges) g.setEdge(e.from, e.to, {}, e.id)

  dagre.layout(g)

  const nodes: LaidNode[] = diagram.nodes.map((n) => {
    const d = g.node(n.id)
    return { ...n, width: d.width, height: d.height, x: d.x - d.width / 2, y: d.y - d.height / 2 }
  })
  const edges: LaidEdge[] = diagram.edges.map((e) => {
    const d = g.edge({ v: e.from, w: e.to, name: e.id })
    return { ...e, points: (d?.points ?? []).map((p) => ({ x: p.x, y: p.y })) }
  })
  const gr = g.graph()
  return { nodes, edges, width: gr.width ?? 0, height: gr.height ?? 0 }
}
