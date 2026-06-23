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
