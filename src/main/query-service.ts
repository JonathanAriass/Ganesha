import type { DB } from './persistence/db'
import { getConnection } from './persistence/connections'
import { addHistory } from './persistence/history'
import type { makeSecretStore } from './persistence/secrets'
import type { DatabaseDriver, QueryResult, QueryRequest } from './drivers/types'
import { assertSqlWritable } from './drivers/sql/readonly-guard'
import { parseMongoQuery } from './drivers/mongo/parse'
import { assertMongoCommandWritable } from './drivers/mongo/command'
import { connectVia } from './connection-runtime'
import type { SshTunnelManager } from './ssh/tunnel-manager'
import { readFileSync } from 'fs'
import type { ResultCache } from './query-cache'

/** Rows main retains per result (the paging ceiling). Beyond it `truncated` stays true — the
 *  driver already fetched more than this only if the underlying query returned more. */
const HARD_CAP = 50000
/** Rows returned on the first run and per `query.fetchMore` page. */
export const PAGE_SIZE = 1000

interface RunArgs {
  db: DB
  secrets: ReturnType<typeof makeSecretStore>
  driver: DatabaseDriver
  connectionId: string
  query: string
  queryId: string
  /** Opens/reuses the SSH tunnel when the connection has one enabled. */
  tunnels: SshTunnelManager
  /** Injected clock for deterministic history timestamps. */
  now: () => number
  /** Retains the full result so the renderer can page it via `query.fetchMore`. */
  cache: ResultCache
}

/** Orchestrate a run: load config+secret, connect, dispatch by type (SQL vs Mongo) through the
 *  read-only guard, run on the driver, and log history on success or failure. */
export async function runUserQuery(args: RunArgs): Promise<QueryResult> {
  const { db, secrets, driver, connectionId, query, queryId, tunnels, now, cache } = args
  const config = getConnection(db, connectionId)
  if (!config) throw new Error(`Connection not found: ${connectionId}`)

  await connectVia(driver, config, {
    tunnels,
    readFile: (p) => readFileSync(p),
    getHopSecret: (hopId) => secrets.getSecret(config.id, `ssh:${hopId}`),
    dbPassword: secrets.getPassword(config.id)
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
    const full = await driver.runQuery(config.id, request, {
      maxRows: HARD_CAP, queryId, readOnly: config.readOnly
    })
    addHistory(db, { connectionId: config.id, query, ranAt: started, durationMs: full.durationMs, success: true })
    // Retain everything main fetched; hand back only the first page plus a flag that more is
    // cached (paged in via query.fetchMore) so a huge result doesn't cross the IPC boundary at once.
    cache.store(queryId, { rows: full.rows, documents: full.documents, columns: full.columns.map((c) => c.name) })
    const page = cache.page(queryId, 0, PAGE_SIZE)
    return page ? { ...full, rows: page.rows, documents: page.documents, hasMore: page.hasMore } : full
  } catch (e) {
    addHistory(db, { connectionId: config.id, query, ranAt: started, durationMs: null, success: false })
    throw e
  }
}
