import type { DB } from './persistence/db'
import { getConnection } from './persistence/connections'
import { addHistory } from './persistence/history'
import type { makeSecretStore } from './persistence/secrets'
import type { DatabaseDriver, QueryResult, QueryRequest } from './drivers/types'
import { assertSqlWritable } from './drivers/sql/readonly-guard'
import { parseMongoQuery } from './drivers/mongo/parse'
import { assertMongoCommandWritable } from './drivers/mongo/command'

const DEFAULT_MAX_ROWS = 1000

interface RunArgs {
  db: DB
  secrets: ReturnType<typeof makeSecretStore>
  driver: DatabaseDriver
  connectionId: string
  query: string
  /** Injected clock for deterministic history timestamps. */
  now: () => number
}

/** Orchestrate a run: load config+secret, connect, dispatch by type (SQL vs Mongo) through the
 *  read-only guard, run on the driver, and log history on success or failure. */
export async function runUserQuery(args: RunArgs): Promise<QueryResult> {
  const { db, secrets, driver, connectionId, query, now } = args
  const config = getConnection(db, connectionId)
  if (!config) throw new Error(`Connection not found: ${connectionId}`)

  await driver.connect({
    id: config.id, type: config.type, host: config.host, port: config.port,
    username: config.username, password: secrets.getPassword(config.id),
    database: config.database, ssl: config.ssl
  })

  const started = now()
  try {
    let request: QueryRequest
    if (config.type === 'mongodb') {
      const command = parseMongoQuery(query)
      assertMongoCommandWritable(command, config.readOnly)
      request = { kind: 'mongo', command }
    } else {
      assertSqlWritable(query, config.readOnly)
      request = { kind: 'sql', sql: query }
    }
    const result = await driver.runQuery(config.id, request, {
      maxRows: DEFAULT_MAX_ROWS, queryId: `${config.id}:${started}`, readOnly: config.readOnly
    })
    addHistory(db, { connectionId: config.id, query, ranAt: started, durationMs: result.durationMs, success: true })
    return result
  } catch (e) {
    addHistory(db, { connectionId: config.id, query, ranAt: started, durationMs: null, success: false })
    throw e
  }
}
