import type { ColumnInfo, DbObject, ObjectRef, Relationship } from '@shared/schema'

// ── Naming helpers (a local copy of the prefix/singular rules used elsewhere; kept tiny) ──
function stripOrderingPrefix(name: string): string {
  return name.replace(/^\d+[_-]/, '')
}
function singularize(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (/(sses|ses|xes|ches|shes)$/.test(s)) return s.slice(0, -2)
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}

/** Stable node id for a table — schema + name, collision-free (names can contain any separator). */
export function nodeKey(schema: string | null, name: string): string {
  return JSON.stringify([schema ?? null, name])
}

/** The entity a foreign-key-style column points at: `company_id` → `company`, `id_user` → `user`.
 *  Null for non-FK columns and the bare key `id`/`_id`. */
function fkEntity(column: string): string | null {
  const c = column.toLowerCase()
  if (c === 'id' || c === '_id') return null
  if (c.endsWith('_id')) return c.slice(0, -3) || null
  if (c.startsWith('id_')) return c.slice(3) || null
  return null
}

/** entity name → table, indexed by each table's prefix-stripped name and its singular, so `company`
 *  resolves to `01_companies`. First table wins on a collision. */
function entityIndex(objects: ObjectRef[]): Map<string, ObjectRef> {
  const idx = new Map<string, ObjectRef>()
  for (const o of objects) {
    const base = stripOrderingPrefix(o.name).toLowerCase()
    for (const key of new Set([base, singularize(base)])) if (!idx.has(key)) idx.set(key, o)
  }
  return idx
}

/** Infer relationships from column naming: a `<x>_id` / `id_<x>` column whose `<x>` resolves to a
 *  table yields a (dashed) edge to that table's `id`. Self-loops are dropped. */
export function inferRelationships(
  objects: ObjectRef[],
  columnsByTable: Map<string, ColumnInfo[]>
): Relationship[] {
  const idx = entityIndex(objects)
  const out: Relationship[] = []
  for (const from of objects) {
    for (const col of columnsByTable.get(nodeKey(from.schema, from.name)) ?? []) {
      const entity = fkEntity(col.name)
      if (!entity) continue
      const to = idx.get(entity) ?? idx.get(singularize(entity))
      if (!to) continue
      if (to.schema === from.schema && to.name === from.name) continue // drop self-loops
      out.push({
        fromSchema: from.schema, fromTable: from.name, fromColumn: col.name,
        toSchema: to.schema, toTable: to.name, toColumn: 'id', origin: 'inferred'
      })
    }
  }
  return out
}

/** Merge declared + inferred edges. Declared win: an inferred edge whose (from table, column) is
 *  already a declared FK is dropped; duplicate inferred edges are de-duped. */
export function mergeRelationships(declared: Relationship[], inferred: Relationship[]): Relationship[] {
  const fromKey = (r: Relationship): string => `${nodeKey(r.fromSchema, r.fromTable)}|${r.fromColumn.toLowerCase()}`
  const claimed = new Set(declared.map(fromKey))
  const seen = new Set<string>()
  const out = [...declared]
  for (const r of inferred) {
    const fk = fromKey(r)
    if (claimed.has(fk) || seen.has(fk)) continue
    seen.add(fk)
    out.push(r)
  }
  return out
}

// ── Diagram model (consumed by the layout + render) ──
export interface DiagramColumn {
  name: string
  isPk: boolean
  isFk: boolean
}
export interface DiagramNode {
  id: string
  schema: string | null
  name: string
  columns: DiagramColumn[]
}
export interface DiagramEdge {
  id: string
  from: string
  to: string
  fromColumn: string
  toColumn: string
  origin: 'declared' | 'inferred'
}
export interface Diagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

/** One relationship of a selected table, from its point of view: `references` = this table's FK
 *  column points OUT to `otherId`; `referenced-by` = `otherId`'s `column` points IN at this table. */
export interface DiagramRelation {
  otherId: string
  column: string
  origin: 'declared' | 'inferred'
  direction: 'references' | 'referenced-by'
}

/** A node's relationships split by direction — the side-panel listing for a selected table. */
export function nodeRelations(edges: DiagramEdge[], id: string): DiagramRelation[] {
  const out: DiagramRelation[] = []
  for (const e of edges) {
    if (e.from === id) out.push({ otherId: e.to, column: e.fromColumn, origin: e.origin, direction: 'references' })
    else if (e.to === id) out.push({ otherId: e.from, column: e.fromColumn, origin: e.origin, direction: 'referenced-by' })
  }
  return out
}

/** A selected node plus every node directly joined to it by an edge (either direction) — the set to
 *  keep lit when a table is selected in the diagram. */
export function neighborNodes(edges: DiagramEdge[], id: string): Set<string> {
  const set = new Set<string>([id])
  for (const e of edges) {
    if (e.from === id) set.add(e.to)
    if (e.to === id) set.add(e.from)
  }
  return set
}

/** The sub-diagram of just `id` and its directly-related tables, with the edges among that set —
 *  the focused view rendered in the modal. */
export function subDiagram(diagram: Diagram, id: string): Diagram {
  const keep = neighborNodes(diagram.edges, id)
  return {
    nodes: diagram.nodes.filter((n) => keep.has(n.id)),
    edges: diagram.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  }
}

/** Build the node/edge model: a node per table (columns marked PK by the `id`/`_id` convention and FK
 *  when they drive a relationship), and an edge per relationship whose BOTH endpoints are known tables
 *  (self-loops and dangling references dropped). */
export function buildDiagram(
  objects: DbObject[],
  columnsByTable: Map<string, ColumnInfo[]>,
  relationships: Relationship[]
): Diagram {
  const nodeIds = new Set(objects.map((o) => nodeKey(o.schema, o.name)))
  const fkCols = new Map<string, Set<string>>()
  for (const r of relationships) {
    const k = nodeKey(r.fromSchema, r.fromTable)
    if (!fkCols.has(k)) fkCols.set(k, new Set())
    fkCols.get(k)!.add(r.fromColumn.toLowerCase())
  }

  const nodes: DiagramNode[] = objects.map((o) => {
    const k = nodeKey(o.schema, o.name)
    const fks = fkCols.get(k) ?? new Set<string>()
    const columns = (columnsByTable.get(k) ?? []).map((c) => {
      const lower = c.name.toLowerCase()
      return { name: c.name, isPk: lower === 'id' || lower === '_id', isFk: fks.has(lower) }
    })
    return { id: k, schema: o.schema, name: o.name, columns }
  })

  const edges: DiagramEdge[] = []
  relationships.forEach((r, i) => {
    const from = nodeKey(r.fromSchema, r.fromTable)
    const to = nodeKey(r.toSchema, r.toTable)
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) return
    edges.push({ id: `e${i}`, from, to, fromColumn: r.fromColumn, toColumn: r.toColumn, origin: r.origin })
  })

  return { nodes, edges }
}
