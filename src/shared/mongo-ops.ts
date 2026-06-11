/** Mongo operation names, shared so the renderer (editor completions) and the main
 *  process (parsers/driver) agree on exactly one list. The op union types are derived
 *  from these arrays; main builds its lookup Sets from them (drivers/mongo/command.ts). */
export const MONGO_READ_OPS = ['find', 'findOne', 'aggregate', 'count', 'countDocuments', 'distinct'] as const
export const MONGO_WRITE_OPS = [
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne'
] as const

export type MongoReadOp = (typeof MONGO_READ_OPS)[number]
export type MongoWriteOp = (typeof MONGO_WRITE_OPS)[number]
export type MongoOp = MongoReadOp | MongoWriteOp

export const MONGO_OPS: readonly MongoOp[] = [...MONGO_READ_OPS, ...MONGO_WRITE_OPS]
