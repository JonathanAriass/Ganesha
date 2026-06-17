import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { Long } from 'bson'
import { MongoDriver } from './mongo'

describe('MongoDriver (integration, requires Docker)', () => {
  let container: StartedTestContainer
  const driver = new MongoDriver()
  const id = 'itest'
  const idAll = 'itest-all' // connected WITHOUT a database — browse-all mode

  beforeAll(async () => {
    container = await new GenericContainer('mongo:7').withExposedPorts(27017).start()
    await driver.connect({
      id, type: 'mongodb', host: container.getHost(), port: container.getMappedPort(27017),
      username: '', password: null, database: 'testdb', ssl: false
    })
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertMany', collection: 'users', documents: [{ name: 'a', age: 30 }, { name: 'b' }] } }, { maxRows: 1000, queryId: 's', readOnly: false })
  })

  afterAll(async () => {
    await driver.disconnect(id)
    await driver.disconnect(idAll)
    await container?.stop()
  })

  it('find returns a key-union table + raw documents', async () => {
    const res = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'users', sort: { name: 1 } } }, { maxRows: 1000, queryId: 'q1', readOnly: false })
    expect(res.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['_id', 'name', 'age']))
    expect(res.documents).toHaveLength(2)
    expect(res.rowCount).toBe(2)
  })

  it('countDocuments and aggregate work', async () => {
    const c = await driver.runQuery(id, { kind: 'mongo', command: { op: 'countDocuments', collection: 'users' } }, { maxRows: 1000, queryId: 'q2', readOnly: false })
    expect(c.rows).toEqual([[2]])
    const agg = await driver.runQuery(id, { kind: 'mongo', command: { op: 'aggregate', collection: 'users', pipeline: [{ $match: { name: 'a' } }] } }, { maxRows: 1000, queryId: 'q3', readOnly: false })
    expect(agg.documents).toHaveLength(1)
  })

  it('find caps rows and flags truncated', async () => {
    const res = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'users' } }, { maxRows: 1, queryId: 'q4', readOnly: false })
    expect(res.rows).toHaveLength(1)
    expect(res.truncated).toBe(true)
  })

  it('listObjects contains users; describeObject contains _id and name', async () => {
    const objects = await driver.listObjects(id)
    expect(objects).toContainEqual({ schema: null, name: 'users', kind: 'collection' })

    const columns = await driver.describeObject(id, { schema: null, name: 'users' })
    const names = columns.map((c) => c.name)
    expect(names).toContain('_id')
    expect(names).toContain('name')
  })

  it('int64 fidelity: a safe Long reads back as a number, past 2^53 as an exact digit string', async () => {
    // Long instances are what parseMongoJson ($numberLong) and the shell parser
    // (NumberLong) now hand the driver — the server stores true int64s.
    await driver.runQuery(
      id,
      { kind: 'mongo', command: { op: 'insertMany', collection: 'fidelity', documents: [{ k: 'small', n: Long.fromNumber(42) }, { k: 'big', n: Long.fromString('9007199254740993') }] } },
      { maxRows: 1000, queryId: 'q6', readOnly: false }
    )
    const res = await driver.runQuery(
      id,
      { kind: 'mongo', command: { op: 'find', collection: 'fidelity' } },
      { maxRows: 1000, queryId: 'q7', readOnly: false }
    )
    const byKey = Object.fromEntries((res.documents as { k: string; n: unknown }[]).map((d) => [d.k, d.n]))
    expect(byKey.small).toBe(42) // ordinary int64s stay native numbers
    expect(byKey.big).toBe('9007199254740993') // relaxed EJSON alone would say …992
  })

  it('cancel kills the comment-tagged op; the connection stays usable', async () => {
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertMany', collection: 'slow', documents: Array.from({ length: 300 }, (_, i) => ({ i })) } }, { maxRows: 1000, queryId: 's2', readOnly: false })

    // ~100ms of server-side JS per doc ≈ 30s nominal — killed long before that.
    // (If cancel were broken, maxTimeMS would end it with a DIFFERENT error.)
    const queryId = 'kill-me'
    const slow = driver.runQuery(
      id,
      { kind: 'mongo', command: { op: 'find', collection: 'slow', filter: { $where: 'sleep(100) || true' } } },
      { maxRows: 1000, queryId, readOnly: false }
    )
    slow.catch(() => {}) // assertion comes later; don't trip the unhandled-rejection watchdog
    await new Promise((r) => setTimeout(r, 500)) // let the op register server-side
    await driver.cancel(id, queryId)
    await expect(slow).rejects.toThrow(/interrupt/i)

    const after = await driver.runQuery(id, { kind: 'mongo', command: { op: 'countDocuments', collection: 'users' } }, { maxRows: 1000, queryId: 'q5', readOnly: false })
    expect(after.rows).toEqual([[2]])
  }, 40_000)

  it('no database → browse-all: cross-db commands route, listObjects groups by db, describeObject follows schema', async () => {
    await driver.connect({
      id: idAll, type: 'mongodb', host: container.getHost(), port: container.getMappedPort(27017),
      username: '', password: null, database: '', ssl: false
    })

    // a plain command (no cmd.database) must NOT silently fall to the 'test' db
    await expect(
      driver.runQuery(idAll, { kind: 'mongo', command: { op: 'find', collection: 'users' } }, { maxRows: 1000, queryId: 'x0', readOnly: false })
    ).rejects.toThrow(/no default database/i)

    // cmd.database routes the write to a second database
    await driver.runQuery(idAll, { kind: 'mongo', command: { op: 'insertOne', collection: 'things', database: 'otherdb', document: { x: 1 } } }, { maxRows: 1000, queryId: 'x1', readOnly: false })

    // and reads back from it (otherdb) AND from testdb seeded by the other connection
    const things = await driver.runQuery(idAll, { kind: 'mongo', command: { op: 'find', collection: 'things', database: 'otherdb' } }, { maxRows: 1000, queryId: 'x2', readOnly: false })
    expect(things.rowCount).toBe(1)
    const users = await driver.runQuery(idAll, { kind: 'mongo', command: { op: 'countDocuments', collection: 'users', database: 'testdb' } }, { maxRows: 1000, queryId: 'x3', readOnly: false })
    expect(users.rows).toEqual([[2]])

    // the tree sees both databases, collections tagged with their db as schema —
    // system databases (admin/config/local) are hidden like SQL system schemas
    const objects = await driver.listObjects(idAll)
    expect(objects).toContainEqual({ schema: 'testdb', name: 'users', kind: 'collection' })
    expect(objects).toContainEqual({ schema: 'otherdb', name: 'things', kind: 'collection' })
    expect(objects.filter((o) => ['admin', 'config', 'local'].includes(o.schema ?? ''))).toEqual([])

    // field inference follows ref.schema
    const columns = await driver.describeObject(idAll, { schema: 'otherdb', name: 'things' })
    expect(columns.map((c) => c.name)).toContain('x')
  })

  it('a find result reports an editable descriptor keyed by _id; aggregate does not', async () => {
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertMany', collection: 'edit_c', documents: [{ _id: 1, name: 'a', age: 30 }, { _id: 2, name: 'b', age: 40 }] } }, { maxRows: 100, queryId: 'e0', readOnly: false })
    const sel = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_c', sort: { _id: 1 } } }, { maxRows: 100, queryId: 'e1', readOnly: false })
    expect(sel.editable).toEqual({ table: { schema: 'testdb', name: 'edit_c' }, keyColumns: ['_id'], columnSources: expect.arrayContaining(['_id', 'name', 'age']) })
    const agg = await driver.runQuery(id, { kind: 'mongo', command: { op: 'aggregate', collection: 'edit_c', pipeline: [{ $match: {} }] } }, { maxRows: 100, queryId: 'e1b', readOnly: false })
    expect(agg.editable).toBeNull()
  })

  it('applyEdits updates a document by _id and preserves value types', async () => {
    const r = await driver.applyEdits(id, { table: { schema: 'testdb', name: 'edit_c' }, rows: [{ key: { _id: 1 }, set: { name: 'AA', age: 31 } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_c', filter: { _id: 1 } } }, { maxRows: 10, queryId: 'e2', readOnly: false })
    const doc = after.documents![0]
    expect(doc.name).toBe('AA')
    expect(doc.age).toBe(31) // stayed a number, not "31"
  })

  it('applyEdits round-trips an ObjectId _id (from the result EJSON)', async () => {
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertOne', collection: 'edit_oid', document: { tag: 'x' } } }, { maxRows: 10, queryId: 'e3', readOnly: false })
    const sel = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_oid' } }, { maxRows: 10, queryId: 'e4', readOnly: false })
    const idCol = sel.columns.findIndex((c) => c.name === '_id')
    const oid = sel.rows[0][idCol] // EJSON { $oid: "…" }
    const r = await driver.applyEdits(id, { table: { schema: 'testdb', name: 'edit_oid' }, rows: [{ key: { _id: oid }, set: { tag: 'y' } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_oid' } }, { maxRows: 10, queryId: 'e5', readOnly: false })
    expect(after.documents![0].tag).toBe('y')
  })

  it('applyEdits round-trips an EJSON wrapper value (Date) to a real BSON type', async () => {
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertOne', collection: 'edit_dt', document: { when: 'placeholder' } } }, { maxRows: 10, queryId: 'd1', readOnly: false })
    const sel = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_dt' } }, { maxRows: 10, queryId: 'd2', readOnly: false })
    const oid = sel.rows[0][sel.columns.findIndex((c) => c.name === '_id')]
    // The renderer coerces the user's `{"$date":…}` JSON text into a plain object; the
    // driver EJSON-deserializes it to a real Date before $set.
    await driver.applyEdits(id, { table: { schema: 'testdb', name: 'edit_dt' }, rows: [{ key: { _id: oid }, set: { when: { $date: '2020-01-02T03:04:05.000Z' } } }] }, { readOnly: false })
    const after = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_dt' } }, { maxRows: 10, queryId: 'd3', readOnly: false })
    const whenCol = after.columns.findIndex((c) => c.name === 'when')
    // Re-serialized as an EJSON {$date} wrapper → proves it was stored as a real BSON Date.
    expect(after.rows[0][whenCol]).toEqual({ $date: '2020-01-02T03:04:05Z' })
  })

  it('applyEdits writes nested and array-element fields via dotted $set paths', async () => {
    await driver.runQuery(id, { kind: 'mongo', command: { op: 'insertOne', collection: 'edit_nested', document: { _id: 1, address: { city: 'Paris', zip: 75001 }, tags: ['a', 'b'] } } }, { maxRows: 10, queryId: 'n1', readOnly: false })
    const r = await driver.applyEdits(id, { table: { schema: 'testdb', name: 'edit_nested' }, rows: [{ key: { _id: 1 }, set: { 'address.city': 'Lyon', 'tags.0': 'z' } }] }, { readOnly: false })
    expect(r.updated).toBe(1)
    const after = await driver.runQuery(id, { kind: 'mongo', command: { op: 'find', collection: 'edit_nested', filter: { _id: 1 } } }, { maxRows: 10, queryId: 'n2', readOnly: false })
    const doc = after.documents![0]
    expect(doc.address).toEqual({ city: 'Lyon', zip: 75001 }) // nested set; sibling untouched
    expect(doc.tags).toEqual(['z', 'b']) // array element set
  })

  it('applyEdits refuses on read-only and throws when the document is gone', async () => {
    await expect(driver.applyEdits(id, { table: { schema: 'testdb', name: 'edit_c' }, rows: [{ key: { _id: 1 }, set: { name: 'z' } }] }, { readOnly: true })).rejects.toThrow(/read-only/i)
    await expect(driver.applyEdits(id, { table: { schema: 'testdb', name: 'edit_c' }, rows: [{ key: { _id: 9999 }, set: { name: 'z' } }] }, { readOnly: false })).rejects.toThrow(/matched 0|expected exactly one/i)
  })
})
