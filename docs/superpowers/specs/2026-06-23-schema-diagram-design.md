# Schema diagram — design

**Goal:** Visualise a connection's full schema (tables, columns, relationships) on an interactive,
pannable/zoomable canvas opened in a new tab, read live from the server.

## Decisions (from brainstorming)

- **New tab** (a non-query tab `kind: 'diagram'`), one per connection, ephemeral (not persisted).
- **Declared FKs (solid) + inferred-from-naming (dashed)**, with a **toggle to hide the inferred** ones.
- **Interactive pan/zoom SVG canvas**, auto-laid-out with `@dagrejs/dagre` (one small layout-only dep).

## Reading the schema (main)

- New driver method `listRelationships(connectionId): Promise<Relationship[]>` — declared foreign keys.
  - Postgres: `pg_constraint` (contype='f') joined to `pg_class`/`pg_attribute`.
  - MySQL/MariaDB: `information_schema.KEY_COLUMN_USAGE` where `REFERENCED_TABLE_NAME IS NOT NULL`.
  - MongoDB: `[]` (no FKs).
- New IPC `schema.relationships` (req connectionId → `Relationship[]`).
- New IPC `schema.allColumns` (req connectionId → `{ schema, name, columns }[]`): main does the
  `Promise.all` over `describeObject`, so the diagram gets every box's columns in one round-trip.

```ts
// shared/schema.ts
export interface Relationship {
  fromSchema: string | null; fromTable: string; fromColumn: string
  toSchema: string | null; toTable: string; toColumn: string
  origin: 'declared' | 'inferred'   // driver returns 'declared'; the renderer adds 'inferred'
}
```

## Relationships drawn

- **Solid** = declared (from the driver).
- **Dashed** = inferred: pure `inferRelationships(tables, columnsByTable)` — a column `<x>_id` / `id_<x>`
  whose `<x>` matches a table name (prefix-stripped + singular/plural, reusing the repo-context naming
  logic) yields an edge to that table's PK. Self-references and columns already covered by a declared
  FK are dropped (`mergeRelationships` dedups; declared wins).
- **"Show inferred" toggle** (default on) filters the dashed edges out.

## Layout & render (renderer)

- `lib/schema-diagram.ts` (pure): `inferRelationships`, `mergeRelationships`, and the node/edge model
  builder `buildDiagram(objects, columnsByTable, relationships)` → `{ nodes, edges }`.
- `lib/diagram-layout.ts` (`@dagrejs/dagre`): `layoutDiagram(nodes, edges)` → node `{x,y}` + edge point
  lists. Node size from column count (fixed width, height = header + rows).
- `DiagramView.tsx`: fetches objects + allColumns + relationships (TanStack), builds + lays out, renders
  an SVG `<g transform="translate(pan) scale(zoom)">` of table boxes (name header + columns, PK ⚷ / FK
  marks) and edges (solid/dashed). Pan = drag, zoom = wheel + fit/＋/－ buttons. A filter box highlights
  matching tables and centres the first match. Read-only. Loading/error/empty states like ObjectTree.

## Tab type

- `QueryTabData` gains `kind?: 'query' | 'diagram'` (absent = query). `openDiagramTab(connectionId)`
  focuses an existing diagram tab for that connection else opens one (title `◇ Schema`). Query-only
  fields stay at their empties.
- `App` renders `<DiagramView>` when the active tab's `kind === 'diagram'`, else `<QueryTab>`.
- Session: `toSessionTabs` skips `kind === 'diagram'` (ephemeral — no SessionTab schema change).
- Grouping/close ops already operate on the flat tabs array → work unchanged.
- Trigger: a "◇ Diagram" button in the sidebar (active connection) + a ⌘K palette action.

## Testing

Pure libs unit-tested: `inferRelationships` (naming → edges, prefix/plural, no self-loops, NN_ tables),
`mergeRelationships` (declared wins, dedup), `buildDiagram` (nodes carry PK/FK marks), `layoutDiagram`
(returns positions for every node, deterministic). `listRelationships` verified by the integration
suite against real Postgres + MySQL FKs. Pan/zoom/filter rendering verified live.

## Out of scope (v1)

Editing the schema, image/SVG export, persisted layout positions, a minimap, Mongo relationship
inference from embedded documents, virtualising the canvas.
