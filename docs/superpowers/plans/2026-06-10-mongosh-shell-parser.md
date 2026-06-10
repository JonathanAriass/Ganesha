# mongosh Shell Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user type `mongosh`-style queries — `db.users.find({ age: { $gt: 21 } }).sort({ name: 1 }).limit(50)` — and have them produce the same validated `MongoCommand` the raw-JSON parser produces. Parse with `acorn` into an AST, walk the `db.<coll>.<op>(args).<modifier>(...)` chain, and evaluate argument expressions (objects/arrays/literals + BSON helpers like `ObjectId(...)`, `ISODate(...)`, `NumberLong(...)`) into real BSON values. Also unify the Mongo input: `parseMongoQuery(text)` auto-detects shell vs JSON, and the raw-JSON path is upgraded to `EJSON.parse` so `{$oid}`/`{$date}` deserialize to BSON (a latent gap from 3a/3d).

**Architecture:** Two pure-logic modules under `src/main/drivers/mongo/`: `shell-eval.ts` (a restricted AST→value evaluator using `bson` constructors) and `shell.ts` (`parseMongoShell` — acorn parse + chain walk + per-op `MongoCommand` mapping). Then a tiny `parse.ts` (`parseMongoQuery` auto-detect) wires both into `query-service`. The driver and read-only guard already consume `MongoCommand` agnostic of where it came from — no driver/guard changes. Everything is unit-tested under Node; no Docker, no driver I/O.

**Tech Stack:** `acorn` (pure-JS parser) + `@types/estree`, `bson` (already installed), Vitest.

**This is Plan 3e** (3a–3d ✓ → **3e mongosh parser** — completes the driver layer → Plan 4 UI + better-sqlite3 ABI fix). Builds on `main` after Plan 3d.

---

## File Structure

```
src/main/drivers/mongo/shell-eval.ts        CREATE — evalArg: AST expression → JS/BSON value
src/main/drivers/mongo/shell-eval.test.ts   CREATE
src/main/drivers/mongo/shell.ts             CREATE — parseMongoShell (acorn + chain walk + op mapping)
src/main/drivers/mongo/shell.test.ts        CREATE
src/main/drivers/mongo/raw.ts               MODIFY — JSON.parse → EJSON.parse (deserialize EJSON to BSON)
src/main/drivers/mongo/parse.ts             CREATE — parseMongoQuery (auto-detect shell vs JSON)
src/main/drivers/mongo/parse.test.ts        CREATE
src/main/query-service.ts                   MODIFY — use parseMongoQuery instead of parseMongoJson
package.json                                MODIFY — add acorn + @types/estree
```

---

## Task 1: The argument evaluator (`evalArg`)

Converts a restricted AST expression node into a JS/BSON value. Supports object/array/literal/unary-minus and the common `mongosh` BSON helper calls. Rejects anything else with a clear error (no arbitrary code execution).

**Files:** Modify `package.json`; create `src/main/drivers/mongo/shell-eval.ts`, `shell-eval.test.ts`.

- [ ] **Step 1: Add deps.** `npm install acorn@^8.12.1 && npm install -D @types/estree@^1.0.5`

- [ ] **Step 2: Write the failing test** `src/main/drivers/mongo/shell-eval.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import type { ExpressionStatement, Expression, Program } from 'estree'
import { ObjectId, Long } from 'bson'
import { evalArg } from './shell-eval'

// helper: parse a single JS expression string into its AST Expression node
function expr(src: string): Expression {
  const program = Parser.parse(src, { ecmaVersion: 2022 }) as unknown as Program
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
})
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/main/drivers/mongo/shell-eval.test.ts`

- [ ] **Step 4: Create `src/main/drivers/mongo/shell-eval.ts`:**
```ts
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
        const key =
          prop.key.type === 'Identifier'
            ? (prop.key as Identifier).name
            : String((prop.key as Literal).value)
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
```

- [ ] **Step 5: Run → PASS** + `npm run typecheck && npm run lint`. **Step 6: Commit:** `git add -A && git commit -m "feat: add mongosh argument evaluator (AST -> JS/BSON, restricted)"`

---

## Task 2: The shell parser (`parseMongoShell`)

**Files:** Create `src/main/drivers/mongo/shell.ts`, `shell.test.ts`.

- [ ] **Step 1: Write the failing test** `src/main/drivers/mongo/shell.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { parseMongoShell } from './shell'

describe('parseMongoShell', () => {
  it('parses find with filter, projection, and chained modifiers', () => {
    const cmd = parseMongoShell('db.users.find({ age: { $gt: 21 } }, { name: 1 }).sort({ name: 1 }).limit(50).skip(10)')
    expect(cmd).toEqual({
      op: 'find', collection: 'users',
      filter: { age: { $gt: 21 } }, projection: { name: 1 }, sort: { name: 1 }, limit: 50, skip: 10
    })
  })

  it('parses aggregate, countDocuments, distinct', () => {
    expect(parseMongoShell('db.orders.aggregate([{ $match: { x: 1 } }])').pipeline).toEqual([{ $match: { x: 1 } }])
    expect(parseMongoShell('db.c.countDocuments({ a: 1 })').filter).toEqual({ a: 1 })
    const d = parseMongoShell('db.c.distinct("country", { active: true })')
    expect(d.field).toBe('country')
    expect(d.filter).toEqual({ active: true })
  })

  it('parses writes (insertOne / updateOne / deleteMany) and BSON helper args', () => {
    expect(parseMongoShell('db.c.insertOne({ a: 1 })').document).toEqual({ a: 1 })
    const upd = parseMongoShell('db.c.updateOne({ a: 1 }, { $set: { a: 2 } })')
    expect(upd.update).toEqual({ $set: { a: 2 } })
    const f = parseMongoShell('db.c.find({ _id: ObjectId("507f1f77bcf86cd799439011") })')
    expect((f.filter!._id as ObjectId).toHexString()).toBe('507f1f77bcf86cd799439011')
  })

  it('rejects unknown ops, non-shell input, and unsupported chained methods', () => {
    expect(() => parseMongoShell('db.c.dropDatabase()')).toThrow(/unsupported operation/i)
    expect(() => parseMongoShell('1 + 1')).toThrow(/mongo shell command/i)
    expect(() => parseMongoShell('db.c.find().bogus()')).toThrow(/unsupported chained method/i)
    expect(() => parseMongoShell('not valid (')).toThrow(/could not parse/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/main/drivers/mongo/shell.test.ts`

- [ ] **Step 3: Create `src/main/drivers/mongo/shell.ts`:**
```ts
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
```

- [ ] **Step 4: Run → PASS** + `npm run typecheck && npm run lint`. **Step 5: Commit:** `git add -A && git commit -m "feat: add mongosh shell parser (acorn chain walk -> MongoCommand)"`

---

## Task 3: Unify the Mongo input (auto-detect + EJSON deserialization)

**Files:** Modify `src/main/drivers/mongo/raw.ts`, `src/main/query-service.ts`; create `src/main/drivers/mongo/parse.ts`, `parse.test.ts`.

- [ ] **Step 1: Upgrade `raw.ts` to deserialize EJSON.** In `src/main/drivers/mongo/raw.ts`, change the parse line so `{$oid}`/`{$date}`/etc. become real BSON (query operators like `$gt` are untouched). Replace:
```ts
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
```
with:
```ts
  let raw: unknown
  try {
    // EJSON.parse is a JSON superset: it deserializes type wrappers ({$oid},{$date},
    // {$numberLong}, ...) into BSON instances while leaving query operators ($gt, $set) intact.
    raw = (require('bson') as typeof import('bson')).EJSON.parse(input, { relaxed: true })
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
```
(`require('bson')` is allowed in `src/main/**` by the ESLint override. The existing raw-parser tests still pass — `$gt`/`$set` aren't EJSON type wrappers, so the parsed values are unchanged.)

- [ ] **Step 2: Write the failing test** `src/main/drivers/mongo/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ObjectId } from 'bson'
import { parseMongoQuery } from './parse'

describe('parseMongoQuery (auto-detect)', () => {
  it('routes db.* input to the shell parser', () => {
    const cmd = parseMongoQuery('  db.users.find({ age: { $gt: 21 } }).limit(5)  ')
    expect(cmd.op).toBe('find')
    expect(cmd.collection).toBe('users')
    expect(cmd.limit).toBe(5)
  })

  it('routes JSON input to the raw parser (and deserializes EJSON to BSON)', () => {
    const cmd = parseMongoQuery('{ "op": "find", "collection": "c", "filter": { "_id": { "$oid": "507f1f77bcf86cd799439011" } } }')
    expect(cmd.op).toBe('find')
    expect((cmd.filter!._id as ObjectId).toHexString?.()).toBe('507f1f77bcf86cd799439011')
  })
})
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/main/drivers/mongo/parse.test.ts`

- [ ] **Step 4: Create `src/main/drivers/mongo/parse.ts`:**
```ts
import type { MongoCommand } from './command'
import { parseMongoJson } from './raw'
import { parseMongoShell } from './shell'

/** Auto-detect the Mongo query input: `db.…` → shell syntax, otherwise raw-JSON. */
export function parseMongoQuery(text: string): MongoCommand {
  const trimmed = text.trim()
  return trimmed.startsWith('db.') ? parseMongoShell(trimmed) : parseMongoJson(trimmed)
}
```

- [ ] **Step 5: Wire `query-service.ts`.** In `src/main/query-service.ts`, change the import `import { parseMongoJson } from './drivers/mongo/raw'` to `import { parseMongoQuery } from './drivers/mongo/parse'`, and in the mongodb branch change `const command = parseMongoJson(query)` to `const command = parseMongoQuery(query)`.

- [ ] **Step 6: Run + full gate.** `npx vitest run src/main/drivers/mongo/parse.test.ts` (PASS) then `npm run typecheck && npm run lint && npm test` — all green (the existing query-service Mongo dispatch test still passes; raw + shell + parse + eval tests green). **Step 7: Commit:**
```bash
git add -A
git commit -m "feat: unify Mongo input via parseMongoQuery (auto-detect shell vs JSON) + EJSON deserialization in raw parser"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** mongosh-style input (`db.coll.op(args).modifier()`) ✓ T2; restricted, safe arg evaluation incl. BSON helpers ✓ T1; both Mongo input modes (shell + raw-JSON) reach the same `MongoCommand` ✓ T3. Driver + read-only guard are unchanged (they consume `MongoCommand` source-agnostically). This completes the spec's Mongo querying (shell + raw-JSON, the user's stated requirement) and closes the 3a/3d EJSON-deserialization gap.
- **Safety:** `evalArg` is a strict allow-list interpreter — only literals, objects, arrays, unary +/-, and a fixed set of BSON helper calls; any other node (identifier reference, member access, arbitrary function call, binary op) throws. No arbitrary code runs.
- **Consistency:** shell args evaluate to real BSON instances; raw-JSON now uses `EJSON.parse` so it too yields BSON — so `query.run` with either input produces an equivalent `MongoCommand`, and the read-only command guard (`assertMongoCommandWritable`) applies uniformly.
- **No new channels / no driver change:** the unification is entirely inside the Mongo parse layer + `query-service`.

## Definition of Done

`npm run typecheck`, `npm run lint`, `npm test` all green (evaluator, shell parser, parse auto-detect, and the existing Mongo-dispatch tests). A `mongosh`-style query and a raw-JSON query both parse to the same `MongoCommand`, with `{$oid}`/`ObjectId(...)` yielding a real `ObjectId`, and the read-only guard still blocking writes on a read-only connection. **The driver layer is complete — all four databases, both Mongo input modes.** On green → **Plan 4 — the UI** (connection manager, object tree, tabbed Monaco editor, virtualized grid + document view, ⌘K, Settings, Midnight theme) **+ the better-sqlite3 Electron-ABI fix** that makes live in-app queries work.
