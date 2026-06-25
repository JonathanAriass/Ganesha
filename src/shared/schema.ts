export interface DbObject {
  schema: string | null
  name: string
  kind: 'table' | 'view' | 'collection'
}

export interface ObjectRef {
  schema: string | null
  name: string
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
}

/** One table with its columns — the bulk shape the schema diagram fetches in a single round-trip. */
export interface TableColumns {
  schema: string | null
  name: string
  columns: ColumnInfo[]
}

/** A foreign-key-style relationship between two tables. `declared` = a real DB foreign key (read from
 *  the catalog); `inferred` = guessed from column naming (`company_id` → `companies`). */
export interface Relationship {
  fromSchema: string | null
  fromTable: string
  fromColumn: string
  toSchema: string | null
  toTable: string
  toColumn: string
  origin: 'declared' | 'inferred'
}

// ── Table info (the "Table info" tab: columns, indexes, foreign keys, constraints, size) ──

/** A column with the extra detail the info tab shows beyond the tree's name+type. */
export interface ColumnDetail extends ColumnInfo {
  default: string | null
  primaryKey: boolean
}

/** One index: its covered columns in order, plus unique/primary flags and the access method. */
export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  method: string | null // pg btree/gin/…; mysql BTREE/…; mongo null / '2dsphere' / 'text'
}

/** One foreign key grouped from its per-column rows: `columns[i]` references `refColumns[i]`. */
export interface ForeignKeyInfo {
  name: string | null
  columns: string[]
  refSchema: string | null
  refTable: string
  refColumns: string[]
}

/** A unique or check constraint not already shown as an index/foreign key. */
export interface ConstraintInfo {
  name: string
  type: 'unique' | 'check'
  detail: string // unique: "(a, b)"; check: the expression
}

/** Approximate table size — both fields may be null when the engine can't report them. */
export interface TableSize {
  rowEstimate: number | null
  bytes: number | null
}

/** Everything the "Table info" tab shows for one table/collection. Sections an engine lacks
 *  (e.g. Mongo foreign keys/constraints) come back empty. */
export interface TableInfo {
  ref: ObjectRef
  columns: ColumnDetail[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[] // outgoing (this table → others)
  referencedBy: ForeignKeyInfo[] // incoming (others → this table)
  constraints: ConstraintInfo[]
  size: TableSize | null
}
