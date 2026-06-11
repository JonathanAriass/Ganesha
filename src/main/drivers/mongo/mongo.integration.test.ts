import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
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
})
