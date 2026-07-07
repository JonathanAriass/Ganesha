import type { IndexInfo, ForeignKeyInfo } from '../../../shared/schema'

interface IndexRow {
  name: string
  column: string
  unique: boolean
  primary: boolean
  method: string | null
  ord: number
}

interface FkRow {
  name: string | null
  column: string
  refSchema: string | null
  refTable: string
  refColumn: string
  ord: number
}

/** Group flat per-column rows by a key, preserving first-appearance order of the keys, and
 *  ordering each group's rows by `ord`. The catalog queries already ORDER BY (name, ord), but
 *  sorting here keeps the helper correct regardless of row arrival order. */
function groupByName<T extends { ord: number }>(rows: T[], keyOf: (r: T) => string): T[][] {
  const order: string[] = []
  const byKey = new Map<string, T[]>()
  for (const r of rows) {
    const k = keyOf(r)
    let bucket = byKey.get(k)
    if (!bucket) {
      bucket = []
      byKey.set(k, bucket)
      order.push(k)
    }
    bucket.push(r)
  }
  return order.map((k) => byKey.get(k)!.slice().sort((a, b) => a.ord - b.ord))
}

/** Fold flat per-column index rows into one `IndexInfo` per index name, columns in `ord` order. */
export function groupIndexes(rows: IndexRow[]): IndexInfo[] {
  return groupByName(rows, (r) => r.name).map((bucket) => {
    const first = bucket[0]
    return {
      name: first.name,
      columns: bucket.map((r) => r.column),
      unique: first.unique,
      primary: first.primary,
      method: first.method,
    }
  })
}

/** Fold flat per-column FK rows into one `ForeignKeyInfo` per constraint name; `columns[i]`
 *  references `refColumns[i]`, both ordered by `ord`. */
export function groupForeignKeys(rows: FkRow[]): ForeignKeyInfo[] {
  return groupByName(rows, (r) => r.name ?? '').map((bucket) => {
    const first = bucket[0]
    return {
      name: first.name,
      columns: bucket.map((r) => r.column),
      refSchema: first.refSchema,
      refTable: first.refTable,
      refColumns: bucket.map((r) => r.refColumn),
    }
  })
}
