export type MongoReadOp = 'find' | 'findOne' | 'aggregate' | 'count' | 'countDocuments' | 'distinct'
export type MongoWriteOp =
  | 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'replaceOne'
export type MongoOp = MongoReadOp | MongoWriteOp

/** A normalized MongoDB operation. Both the raw-JSON parser (Plan 3a) and the
 *  mongosh shell parser (Plan 3c) produce this; the Mongo driver (3b) dispatches on it. */
export interface MongoCommand {
  op: MongoOp
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, unknown>
  limit?: number
  skip?: number
  pipeline?: Record<string, unknown>[]
  document?: Record<string, unknown>
  documents?: Record<string, unknown>[]
  update?: Record<string, unknown>
  replacement?: Record<string, unknown>
  field?: string
}

const READ_OPS = new Set<MongoOp>(['find', 'findOne', 'aggregate', 'count', 'countDocuments', 'distinct'])
const WRITE_OPS = new Set<MongoWriteOp>([
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne'
])
const ALL_OPS = new Set<MongoOp>([...READ_OPS, ...WRITE_OPS])

export function isMongoOp(s: string): s is MongoOp {
  return ALL_OPS.has(s as MongoOp)
}

export function isMongoReadOp(op: MongoOp): boolean {
  return READ_OPS.has(op)
}

/** Throw if a write op is issued on a read-only connection. */
export function assertMongoWritable(op: MongoOp, readOnly: boolean): void {
  if (readOnly && !isMongoReadOp(op)) {
    throw new Error(`This connection is read-only — '${op}' is a write operation and is blocked.`)
  }
}

function pipelineHasWriteStage(pipeline: Record<string, unknown>[] | undefined): boolean {
  return !!pipeline?.some((stage) => '$out' in stage || '$merge' in stage)
}

/** True if the command writes — a write op, or an aggregate with a $out/$merge stage. */
export function isMongoCommandWrite(cmd: MongoCommand): boolean {
  if (!isMongoReadOp(cmd.op)) return true
  return cmd.op === 'aggregate' && pipelineHasWriteStage(cmd.pipeline)
}

/** Throw if the command writes on a read-only connection (covers aggregate $out/$merge). */
export function assertMongoCommandWritable(cmd: MongoCommand, readOnly: boolean): void {
  if (readOnly && isMongoCommandWrite(cmd)) {
    const detail = cmd.op === 'aggregate' ? `'aggregate' with $out/$merge` : `'${cmd.op}'`
    throw new Error(`This connection is read-only — ${detail} is a write operation and is blocked.`)
  }
}
