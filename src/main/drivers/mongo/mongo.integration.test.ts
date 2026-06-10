import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { MongoDriver } from './mongo'

describe('MongoDriver (integration, requires Docker)', () => {
  let container: StartedTestContainer
  const driver = new MongoDriver()
  const id = 'itest'

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
})
