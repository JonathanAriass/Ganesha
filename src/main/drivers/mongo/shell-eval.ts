import { ObjectId, Long, Int32, Double, Decimal128, UUID } from 'bson'
import type {
  Expression, Property, Literal, ObjectExpression, ArrayExpression,
  UnaryExpression, CallExpression, NewExpression, Identifier
} from 'estree'

/** Evaluate a BSON helper call like ObjectId("..."), ISODate("..."), NumberLong("..."). */
function evalHelper(name: string, args: unknown[]): unknown {
  switch (name) {
    case 'ObjectId':
      return new ObjectId(args[0] as string | undefined)
    case 'ISODate':
    case 'Date':
      return args.length ? new Date(args[0] as string | number) : new Date()
    case 'NumberLong':
      return Long.fromString(String(args[0]))
    case 'NumberInt':
      return new Int32(Number(args[0]))
    case 'NumberDouble':
      return new Double(Number(args[0]))
    case 'NumberDecimal':
      return Decimal128.fromString(String(args[0]))
    case 'UUID':
      return new UUID(args[0] as string | undefined)
    default:
      throw new Error(`Unsupported helper '${name}()' in mongo shell input`)
  }
}

/** Evaluate a restricted AST expression to a JS/BSON value. Throws on anything unsupported. */
export function evalArg(node: Expression | null): unknown {
  if (!node) return null
  switch (node.type) {
    case 'Literal':
      return (node as Literal).value
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const p of (node as ObjectExpression).properties) {
        if (p.type !== 'Property') throw new Error('Unsupported object property (spread not allowed)')
        const prop = p as Property
        if (prop.computed) throw new Error('Computed object keys are not supported in mongo shell input')
        const key =
          prop.key.type === 'Identifier'
            ? (prop.key as Identifier).name
            : String((prop.key as Literal).value)
        // Reject __proto__ so a parsed object can never carry an attacker-controlled prototype.
        if (key === '__proto__') throw new Error("Object key '__proto__' is not allowed in mongo shell input")
        out[key] = evalArg(prop.value as Expression)
      }
      return out
    }
    case 'ArrayExpression':
      return (node as ArrayExpression).elements.map((el) => evalArg(el as Expression | null))
    case 'UnaryExpression': {
      const u = node as UnaryExpression
      const v = evalArg(u.argument)
      if (u.operator === '-') return -(v as number)
      if (u.operator === '+') return +(v as number)
      throw new Error(`Unsupported unary operator '${u.operator}'`)
    }
    case 'Identifier': {
      const name = (node as Identifier).name
      if (name === 'undefined') return undefined
      if (name === 'NaN') return NaN
      if (name === 'Infinity') return Infinity
      throw new Error(`Unsupported identifier '${name}' (only literals, objects, arrays, and BSON helpers are allowed)`)
    }
    case 'CallExpression':
    case 'NewExpression': {
      const call = node as CallExpression | NewExpression
      if (call.callee.type !== 'Identifier') throw new Error('Unsupported call expression in mongo shell input')
      const args = call.arguments.map((a) => evalArg(a as Expression))
      return evalHelper((call.callee as Identifier).name, args)
    }
    default:
      throw new Error(`Unsupported expression in mongo shell input: ${node.type}`)
  }
}
