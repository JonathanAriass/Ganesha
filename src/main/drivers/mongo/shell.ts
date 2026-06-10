import { Parser } from 'acorn'
import type {
  Program, ExpressionStatement, Expression, CallExpression, MemberExpression, Identifier, Literal
} from 'estree'
import { evalArg } from './shell-eval'
import { isMongoOp, type MongoCommand, type MongoOp } from './command'

const MODIFIERS = new Set(['sort', 'limit', 'skip', 'project', 'projection'])

function asObj(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`'${field}' must be an object`)
  return v as Record<string, unknown>
}
function asArr(v: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) throw new Error(`'${field}' must be an array`)
  return v as Record<string, unknown>[]
}
function asNonNegInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`'${field}' must be a non-negative integer`)
  return v
}
function asStr(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`'${field}' must be a non-empty string`)
  return v
}

interface Modifier {
  name: string
  args: unknown[]
}

/** Parse a mongosh-style command `db.<coll>.<op>(args).<modifier>(...)` into a MongoCommand. */
export function parseMongoShell(input: string): MongoCommand {
  let program: Program
  try {
    program = Parser.parse(input.trim(), { ecmaVersion: 2022 }) as unknown as Program
  } catch (e) {
    throw new Error(`Could not parse mongo shell command: ${(e as Error).message}`)
  }
  if (program.body.length !== 1 || program.body[0].type !== 'ExpressionStatement') {
    throw new Error('Expected a single mongo shell command, e.g. db.coll.find({ ... })')
  }

  let node: Expression = (program.body[0] as ExpressionStatement).expression
  const modifiers: Modifier[] = []

  while (node.type === 'CallExpression') {
    const call = node as CallExpression
    if (call.callee.type !== 'MemberExpression') throw new Error('Unsupported mongo shell syntax')
    const callee = call.callee as MemberExpression
    if (callee.property.type !== 'Identifier') throw new Error('Unsupported mongo shell syntax')
    const method = (callee.property as Identifier).name
    const args = call.arguments.map((a) => evalArg(a as Expression))
    const inner = callee.object

    if (inner.type === 'MemberExpression' && (inner as MemberExpression).object.type === 'Identifier'
      && ((inner as MemberExpression).object as Identifier).name === 'db') {
      const innerMem = inner as MemberExpression
      const collection =
        innerMem.property.type === 'Identifier'
          ? (innerMem.property as Identifier).name
          : innerMem.property.type === 'Literal'
            ? String((innerMem.property as Literal).value)
            : ''
      if (!collection) throw new Error('Could not determine collection name')
      if (!isMongoOp(method)) throw new Error(`Unsupported operation 'db.${collection}.${method}()'`)
      return buildCommand(method, collection, args, modifiers)
    }

    if (!MODIFIERS.has(method)) throw new Error(`Unsupported chained method '.${method}()'`)
    modifiers.push({ name: method, args })
    node = inner as Expression
  }

  throw new Error('Expected a mongo shell command like db.coll.find({ ... })')
}

function buildCommand(op: MongoOp, collection: string, args: unknown[], modifiers: Modifier[]): MongoCommand {
  const cmd: MongoCommand = { op, collection }
  switch (op) {
    case 'find':
    case 'findOne':
    case 'count':
    case 'countDocuments':
      if (args[0] !== undefined) cmd.filter = asObj(args[0], 'filter')
      if (args[1] !== undefined) cmd.projection = asObj(args[1], 'projection')
      break
    case 'aggregate':
      cmd.pipeline = asArr(args[0], 'pipeline')
      break
    case 'distinct':
      cmd.field = asStr(args[0], 'field')
      if (args[1] !== undefined) cmd.filter = asObj(args[1], 'filter')
      break
    case 'insertOne':
      cmd.document = asObj(args[0], 'document')
      break
    case 'insertMany':
      cmd.documents = asArr(args[0], 'documents')
      break
    case 'updateOne':
    case 'updateMany':
      cmd.filter = asObj(args[0], 'filter')
      cmd.update = asObj(args[1], 'update')
      break
    case 'replaceOne':
      cmd.filter = asObj(args[0], 'filter')
      cmd.replacement = asObj(args[1], 'replacement')
      break
    case 'deleteOne':
    case 'deleteMany':
      cmd.filter = asObj(args[0], 'filter')
      break
  }
  for (const m of modifiers) {
    if (op !== 'find' && op !== 'findOne') throw new Error(`'.${m.name}()' is only supported on find/findOne`)
    if (m.name === 'sort') cmd.sort = asObj(m.args[0], 'sort')
    else if (m.name === 'limit') cmd.limit = asNonNegInt(m.args[0], 'limit')
    else if (m.name === 'skip') cmd.skip = asNonNegInt(m.args[0], 'skip')
    else cmd.projection = asObj(m.args[0], 'projection')
  }
  return cmd
}
