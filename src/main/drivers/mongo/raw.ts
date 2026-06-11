import { EJSON } from 'bson'
import { type MongoCommand, type MongoOp, isMongoOp } from './command'

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
    raw = EJSON.parse(input, { relaxed: true })
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
