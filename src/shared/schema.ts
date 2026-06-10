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
