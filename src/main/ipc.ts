import { ipcMain, clipboard } from 'electron'
import type { ChannelName, Req, Res } from '../shared/ipc'
import { ok, err, type Result } from '../shared/result'
import { openDb } from './persistence/db'
import { safeStorageEncryptor, makeSecretStore } from './persistence/secrets'
import * as conns from './persistence/connections'
import * as hist from './persistence/history'
import * as settings from './persistence/settings'
import { DriverManager } from './drivers/registry'
import { PostgresDriver } from './drivers/sql/postgres'
import { MySqlDriver } from './drivers/sql/mysql'
import { MongoDriver } from './drivers/mongo/mongo'
import { runUserQuery } from './query-service'
import { buildConnectParams } from './drivers/params'

const drivers = new DriverManager()
drivers.register(new PostgresDriver())
drivers.register(new MySqlDriver('mysql'))
drivers.register(new MySqlDriver('mariadb'))
drivers.register(new MongoDriver())

type Handler<K extends ChannelName> = (req: Req<K>) => Result<Res<K>> | Promise<Result<Res<K>>>

/** Register a single typed channel handler; any thrown error becomes err(message). */
export function handle<K extends ChannelName>(channel: K, fn: Handler<K>): void {
  ipcMain.handle(channel, async (_event, req: Req<K>) => {
    try {
      return await fn(req)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })
}

function now(): number {
  return Date.now()
}

/**
 * Resolve the CURRENT db + a secret store on every call. openDb() returns the
 * live singleton (reopened after any data-dir relocation), so handlers never
 * hold a stale/closed connection.
 */
function store(): { db: ReturnType<typeof openDb>; secrets: ReturnType<typeof makeSecretStore> } {
  const db = openDb()
  return { db, secrets: makeSecretStore(db, safeStorageEncryptor()) }
}

/** Register every main-process IPC handler. Called once on app ready. */
export function registerIpcHandlers(): void {
  handle('ping', (message) => ok({ pong: message }))

  handle('connections.list', () => ok(conns.listConnections(store().db)))
  handle('connections.get', (id) => ok(conns.getConnection(store().db, id)))
  handle('connections.create', ({ input, password }) => {
    const { db, secrets } = store()
    const c = conns.createConnection(db, input, now())
    if (password !== null) secrets.setPassword(c.id, password)
    return ok(c)
  })
  handle('connections.update', async ({ id, patch, password }) => {
    const { db, secrets } = store()
    const before = conns.getConnection(db, id)
    const c = conns.updateConnection(db, id, patch, now())
    // If the type changed, the live pool is registered under the OLD type's driver.
    if (before && before.type !== c.type && drivers.has(before.type)) {
      await drivers.get(before.type).disconnect(id)
    }
    if (password !== undefined) {
      if (password === null) secrets.deletePassword(id)
      else secrets.setPassword(id, password)
    }
    // Pools keep their original credentials (connect() is idempotent) — drop the live
    // pool so the next access reconnects with the just-saved config + password.
    if (drivers.has(c.type)) await drivers.get(c.type).disconnect(id)
    return ok(c)
  })
  handle('connections.delete', async (id) => {
    const { db } = store()
    const c = conns.getConnection(db, id)
    if (c && drivers.has(c.type)) await drivers.get(c.type).disconnect(id)
    conns.deleteConnection(db, id)
    return ok(null)
  })

  handle('history.add', (entry) => ok(hist.addHistory(store().db, entry)))
  handle('history.list', ({ connectionId, limit }) => ok(hist.listHistory(store().db, connectionId, limit)))

  handle('settings.get', () => ok(settings.getSettings(store().db)))
  handle('settings.set', ({ key, value }) => {
    const { db } = store()
    settings.setSetting(db, key, value)
    return ok(settings.getSettings(db))
  })
  handle('settings.dataDir.get', () => ok(settings.getCurrentDataDir()))
  handle('settings.dataDir.set', (dir) => { settings.relocateDataDir(dir); void openDb(); return ok(dir) })

  handle('connections.test', async ({ input, password }) => {
    const driver = drivers.get(input.type)
    await driver.testConnection({
      id: 'test', type: input.type, host: input.host, port: input.port,
      username: input.username, password, database: input.database, ssl: input.ssl
    })
    return ok(null)
  })
  handle('connections.disconnect', async (id) => {
    const c = conns.getConnection(store().db, id)
    if (c && drivers.has(c.type)) await drivers.get(c.type).disconnect(id)
    return ok(null)
  })
  handle('query.run', async ({ connectionId, query, queryId }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const result = await runUserQuery({ db, secrets, driver: drivers.get(c.type), connectionId, query, queryId, now: () => Date.now() })
    return ok(result)
  })
  handle('query.cancel', async ({ connectionId, queryId }) => {
    const c = conns.getConnection(store().db, connectionId)
    if (c && drivers.has(c.type)) await drivers.get(c.type).cancel(connectionId, queryId)
    return ok(null)
  })
  handle('schema.objects', async (connectionId) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const driver = drivers.get(c.type)
    await driver.connect(buildConnectParams(c, secrets.getPassword(c.id)))
    return ok(await driver.listObjects(c.id))
  })
  handle('schema.columns', async ({ connectionId, ref }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const driver = drivers.get(c.type)
    await driver.connect(buildConnectParams(c, secrets.getPassword(c.id)))
    return ok(await driver.describeObject(c.id, ref))
  })

  // navigator.clipboard is permission-gated in the sandboxed renderer; route via main.
  handle('clipboard.copy', (text) => { clipboard.writeText(text); return ok(null) })
}
