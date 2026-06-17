import { EJSON, type Long } from 'bson'
import type { QueryResult, ColumnMeta } from '../../../shared/query'
import { mongoEditable } from './edit-target'

/** Exactness first: relaxed EJSON turns Int64 (Long) into a JS double, silently
 *  corrupting values past 2^53 (…993 reads as …992). Convert Longs ourselves —
 *  native number while Number-safe, exact digit string beyond — the same
 *  contract the SQL drivers give (pg int8 strings, mysql2 supportBigNumbers).
 *  A blanket {relaxed:false} would fix this too but wraps EVERY int in
 *  {$numberInt:…} noise (deliberately rejected — see roadmap). Recurses only
 *  into plain objects/arrays; other BSON types stay EJSON.serialize's job. */
function exactLongs(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  if ((v as { _bsontype?: unknown })._bsontype === 'Long') {
    const n = (v as Long).toNumber()
    return Number.isSafeInteger(n) ? n : (v as Long).toString()
  }
  if (Array.isArray(v)) return v.map(exactLongs)
  const proto = Object.getPrototypeOf(v)
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, exactLongs(x)]))
  }
  // Date, ObjectId, Decimal128, Binary, … — not containers, don't walk in. Known
  // accepted gap: the two legacy types with interiors (Code-with-scope's $scope,
  // DBRef's extra fields) can hold Longs we never reach, so those still serialize
  // relaxed-lossy past 2^53 — too rare/deprecated to earn branches here.
  return v
}

/** Serialize a BSON document/value to plain, IPC-safe EJSON (ObjectId -> {$oid}, Date -> {$date}, ...). */
function toPlain<T = Record<string, unknown>>(value: unknown): T {
  return EJSON.serialize(exactLongs(value) as object) as T
}

/** find / findOne / aggregate → flat key-union table + raw EJSON documents. `editTable`
 *  is supplied only for a real single-collection read (find/findOne), making the result
 *  editable when `_id` is present; aggregate omits it (it can reshape documents). */
export function normalizeFind(
  docs: unknown[],
  maxRows: number,
  durationMs: number,
  editTable?: { schema: string | null; name: string }
): QueryResult {
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
  return {
    columns, rows, rowCount: capped.length, durationMs, truncated, documents: capped,
    editable: editTable ? mongoEditable(columns, editTable) : null
  }
}

/** count / countDocuments → single scalar cell. */
export function normalizeScalar(name: string, value: unknown, durationMs: number): QueryResult {
  const cell = (toPlain<{ v: unknown }>({ v: value })).v
  return { columns: [{ name, dataType: null }], rows: [[cell]], rowCount: 1, durationMs, truncated: false, documents: null, editable: null }
}

/** distinct → one column of values. */
export function normalizeValues(name: string, values: unknown[], maxRows: number, durationMs: number): QueryResult {
  const plain = toPlain<unknown[]>(values)
  const truncated = plain.length > maxRows
  const capped = truncated ? plain.slice(0, maxRows) : plain
  return { columns: [{ name, dataType: null }], rows: capped.map((v) => [v]), rowCount: plain.length, durationMs, truncated, documents: null, editable: null }
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
    documents: null,
    editable: null
  }
}
