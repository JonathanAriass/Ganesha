import { EJSON } from 'bson'
import type { QueryResult, ColumnMeta } from '../../../shared/query'

/** Serialize a BSON document/value to plain, IPC-safe EJSON (ObjectId -> {$oid}, Date -> {$date}, ...). */
function toPlain<T = Record<string, unknown>>(value: unknown): T {
  return EJSON.serialize(value as object) as T
}

/** find / findOne / aggregate → flat key-union table + raw EJSON documents. */
export function normalizeFind(docs: unknown[], maxRows: number, durationMs: number): QueryResult {
  const total = docs.length
  const truncated = total > maxRows
  // Serialize only the visible subset — aggregate has no cursor-level limit, so this
  // avoids EJSON-serializing thousands of docs we'd immediately discard.
  const capped = (truncated ? docs.slice(0, maxRows) : docs).map((d) => toPlain(d))

  const keys: string[] = []
  const seen = new Set<string>()
  for (const d of capped) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  const columns: ColumnMeta[] = keys.map((name) => ({ name, dataType: null }))
  const rows = capped.map((d) => keys.map((k) => (k in d ? d[k] : null)))
  // The fetch is bounded at maxRows+1, so when truncated the true total is unknown —
  // `total` would just be the probe size. Report the shown count; `truncated` says "more".
  return { columns, rows, rowCount: capped.length, durationMs, truncated, documents: capped }
}

/** count / countDocuments → single scalar cell. */
export function normalizeScalar(name: string, value: unknown, durationMs: number): QueryResult {
  const cell = (toPlain<{ v: unknown }>({ v: value })).v
  return { columns: [{ name, dataType: null }], rows: [[cell]], rowCount: 1, durationMs, truncated: false, documents: null }
}

/** distinct → one column of values. */
export function normalizeValues(name: string, values: unknown[], maxRows: number, durationMs: number): QueryResult {
  const plain = toPlain<unknown[]>(values)
  const truncated = plain.length > maxRows
  const capped = truncated ? plain.slice(0, maxRows) : plain
  return { columns: [{ name, dataType: null }], rows: capped.map((v) => [v]), rowCount: plain.length, durationMs, truncated, documents: null }
}

/** insert/update/delete/replace → flatten the driver's result object into one row. */
export function normalizeWriteResult(result: unknown, durationMs: number): QueryResult {
  const plain = toPlain(result)
  const keys = Object.keys(plain)
  return {
    columns: keys.map((name) => ({ name, dataType: null })),
    rows: [keys.map((k) => plain[k])],
    rowCount: 1,
    durationMs,
    truncated: false,
    documents: null
  }
}
