import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import type { ExpressionStatement, Expression, Program } from 'estree'
import { ObjectId, Long } from 'bson'
import { evalArg } from './shell-eval'

function expr(src: string): Expression {
  // Bare object literals like `{ a: 1 }` are ambiguous with block statements at
  // the top level; wrap them in parentheses so acorn parses them as expressions.
  const wrapped = src.trimStart().startsWith('{') ? `(${src})` : src
  const program = Parser.parse(wrapped, { ecmaVersion: 2022 }) as unknown as Program
  return (program.body[0] as ExpressionStatement).expression
}

describe('evalArg', () => {
  it('evaluates literals, objects, arrays, and unary minus', () => {
    expect(evalArg(expr('42'))).toBe(42)
    expect(evalArg(expr('"hi"'))).toBe('hi')
    expect(evalArg(expr('true'))).toBe(true)
    expect(evalArg(expr('null'))).toBeNull()
    expect(evalArg(expr('-5'))).toBe(-5)
    expect(evalArg(expr('{ a: 1, "b": [2, 3] }'))).toEqual({ a: 1, b: [2, 3] })
    expect(evalArg(expr('{ age: { $gt: 21 } }'))).toEqual({ age: { $gt: 21 } })
  })

  it('evaluates BSON helpers ObjectId / ISODate / NumberLong', () => {
    const oid = evalArg(expr('ObjectId("507f1f77bcf86cd799439011")'))
    expect(oid).toBeInstanceOf(ObjectId)
    expect((oid as ObjectId).toHexString()).toBe('507f1f77bcf86cd799439011')
    const d = evalArg(expr('ISODate("2021-01-02T03:04:05Z")'))
    expect(d).toBeInstanceOf(Date)
    expect((d as Date).toISOString()).toBe('2021-01-02T03:04:05.000Z')
    expect(evalArg(expr('NumberLong("123")'))).toBeInstanceOf(Long)
  })

  it('rejects unsupported expressions and unknown helpers', () => {
    expect(() => evalArg(expr('someVar'))).toThrow(/unsupported/i)
    expect(() => evalArg(expr('fetch("http://x")'))).toThrow(/unsupported helper/i)
    expect(() => evalArg(expr('a + b'))).toThrow(/unsupported/i)
  })

  it('rejects __proto__ keys and computed keys (defense-in-depth)', () => {
    expect(() => evalArg(expr('{ "__proto__": { "x": 1 } }'))).toThrow(/__proto__/)
    expect(() => evalArg(expr('{ [foo]: 1 }'))).toThrow(/computed/i)
  })
})
