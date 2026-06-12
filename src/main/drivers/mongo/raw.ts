import { EJSON } from 'bson'
import { type MongoCommand, type MongoOp, isMongoOp } from './command'

/** Undo canonical parsing's number wrapping by walking the EJSON tree alongside
 *  the plain JSON.parse tree of the same input. Int32/Double instances become the
 *  plain JS numbers relaxed mode would have produced (both are losslessly
 *  representable). Canonical mode also wraps BARE integers past int32 range
 *  (epoch millis, 5000000000, …) in Long — those go back to plain numbers too
 *  (`j` is a number exactly where the source JSON had a bare number), so envelope
 *  scalars (limit/skip), server-side types and shell-mode parity all stay exactly
 *  as before. Only an explicit {$numberLong:"…"} wrapper keeps its Long instance —
 *  that's the point: it can't survive as a number past 2^53. The two trees diverge
 *  only at wrapper nodes, and every wrapper is handled before recursion.
 *  Recurses plain objects/arrays only. */
function unwrapNumbers(v: unknown, j: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const t = (v as { _bsontype?: unknown })._bsontype
  // Accepted divergence: a malformed {"$numberInt":"xyz"} comes out 0 here where
  // relaxed parsing yields NaN — garbage in either way, and neither mode throws.
  if (t === 'Int32' || t === 'Double') return (v as { valueOf(): number }).valueOf()
  if (t === 'Long') return typeof j === 'number' ? j : v
  if (Array.isArray(v)) {
    return v.map((x, i) => unwrapNumbers(x, Array.isArray(j) ? (j as unknown[])[i] : undefined))
  }
  const proto = Object.getPrototypeOf(v)
  if (proto === Object.prototype || proto === null) {
    const src = j !== null && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : undefined
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrapNumbers(x, src?.[k])]))
  }
  return v // ObjectId, Decimal128, Date ($date has no _bsontype!), … intact
}

function asObject(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`'${field}' must be an object`)
  }
  return v as Record<string, unknown>
}

function asNonNegInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error(`'${field}' must be a non-negative integer`)
  }
  return v
}

/** Parse the raw-JSON query mode into a validated MongoCommand. */
export function parseMongoJson(input: string): MongoCommand {
  let raw: unknown
  try {
    // EJSON.parse is a JSON superset: it deserializes type wrappers ({$oid},{$date},
    // {$numberLong}, ...) into BSON instances while leaving query operators ($gt, $set) intact.
    // Canonical mode, NOT relaxed: relaxed parsing collapses an explicit $numberLong
    // into a JS double — silently corrupting it past 2^53 before it ever reaches the
    // server. unwrapNumbers() then walks the result against a plain JSON.parse of the
    // same input (which cannot throw if EJSON.parse didn't) and restores relaxed
    // behavior everywhere except explicit $numberLong, which the mongodb driver
    // encodes as a true int64.
    raw = unwrapNumbers(EJSON.parse(input, { relaxed: false }), JSON.parse(input))
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Command must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.op !== 'string' || !isMongoOp(obj.op)) {
    throw new Error(`Unknown or missing 'op' (got ${JSON.stringify(obj.op)})`)
  }
  const op = obj.op as MongoOp
  if (typeof obj.collection !== 'string' || obj.collection.length === 0) {
    throw new Error(`'collection' must be a non-empty string`)
  }

  const cmd: MongoCommand = { op, collection: obj.collection }
  if (obj.database !== undefined) {
    if (typeof obj.database !== 'string' || obj.database.length === 0) {
      throw new Error(`'database' must be a non-empty string`)
    }
    cmd.database = obj.database
  }

  switch (op) {
    case 'find':
    case 'findOne':
    case 'count':
    case 'countDocuments': {
      if (obj.filter !== undefined) cmd.filter = asObject(obj.filter, 'filter')
      if (obj.projection !== undefined) cmd.projection = asObject(obj.projection, 'projection')
      if (obj.sort !== undefined) cmd.sort = asObject(obj.sort, 'sort')
      if (obj.limit !== undefined) cmd.limit = asNonNegInt(obj.limit, 'limit')
      if (obj.skip !== undefined) cmd.skip = asNonNegInt(obj.skip, 'skip')
      break
    }
    case 'aggregate': {
      if (!Array.isArray(obj.pipeline)) throw new Error(`'aggregate' requires a 'pipeline' array`)
      cmd.pipeline = obj.pipeline.map((s, i) => asObject(s, `pipeline[${i}]`))
      break
    }
    case 'distinct': {
      if (typeof obj.field !== 'string' || obj.field.length === 0) {
        throw new Error(`'distinct' requires a 'field' string`)
      }
      cmd.field = obj.field
      if (obj.filter !== undefined) cmd.filter = asObject(obj.filter, 'filter')
      break
    }
    case 'insertOne': {
      cmd.document = asObject(obj.document, 'document')
      break
    }
    case 'insertMany': {
      if (!Array.isArray(obj.documents)) throw new Error(`'insertMany' requires a 'documents' array`)
      cmd.documents = obj.documents.map((d, i) => asObject(d, `documents[${i}]`))
      break
    }
    case 'updateOne':
    case 'updateMany': {
      cmd.filter = asObject(obj.filter, 'filter')
      cmd.update = asObject(obj.update, 'update')
      break
    }
    case 'replaceOne': {
      cmd.filter = asObject(obj.filter, 'filter')
      cmd.replacement = asObject(obj.replacement, 'replacement')
      break
    }
    case 'deleteOne':
    case 'deleteMany': {
      cmd.filter = asObject(obj.filter, 'filter')
      break
    }
  }
  return cmd
}
