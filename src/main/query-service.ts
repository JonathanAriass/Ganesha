import type { DB } from './persistence/db'
import { getConnection } from './persistence/connections'
import { addHistory } from './persistence/history'
import type { makeSecretStore } from './persistence/secrets'
import type { DatabaseDriver, QueryResult } from './drivers/types'
import { assertSqlWritable } from './drivers/sql/readonly-guard'

const DEFAULT_MAX_ROWS = 1000

interface RunArgs {
  db: DB
  secrets: ReturnType<typeof makeSecretStore>
  driver: DatabaseDriver
  connectionId: string
  sql: string
  /** Injected clock for deterministic history timestamps. */
  now: () => number
}

/** Orchestrate a SQL run: load config+secret, guard, connect, run, log history. */
export async function runUserQuery(args: RunArgs): Promise<QueryResult> {
  const { db, secrets, driver, connectionId, sql, now } = args
  const config = getConnection(db, connectionId)
  if (!config) throw new Error(`Connection not found: ${connectionId}`)

  await driver.connect({
    id: config.id, type: config.type, host: config.host, port: config.port,
    username: config.username, password: secrets.getPassword(config.id),
    database: config.database, ssl: config.ssl
  })

  const started = now()
  try {
    assertSqlWritable(sql, config.readOnly)
    const result = await driver.runQuery(
      config.id,
      { kind: 'sql', sql },
      { maxRows: DEFAULT_MAX_ROWS, queryId: `${config.id}:${started}`, readOnly: config.readOnly }
    )
    addHistory(db, { connectionId: config.id, query: sql, ranAt: started, durationMs: result.durationMs, success: true })
    return result
  } catch (e) {
    addHistory(db, { connectionId: config.id, query: sql, ranAt: started, durationMs: null, success: false })
    throw e
  }
}
