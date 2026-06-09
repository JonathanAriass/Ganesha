import { ipcMain } from 'electron'
import type { ChannelName, Req, Res } from '../shared/ipc'
import { ok, err, type Result } from '../shared/result'
import { openDb } from './persistence/db'
import { safeStorageEncryptor, makeSecretStore } from './persistence/secrets'
import * as conns from './persistence/connections'
import * as hist from './persistence/history'
import * as settings from './persistence/settings'

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
    if (password) secrets.setPassword(c.id, password)
    return ok(c)
  })
  handle('connections.update', ({ id, patch, password }) => {
    const { db, secrets } = store()
    const c = conns.updateConnection(db, id, patch, now())
    if (password !== undefined) {
      if (password === null) secrets.deletePassword(id)
      else secrets.setPassword(id, password)
    }
    return ok(c)
  })
  handle('connections.delete', (id) => { conns.deleteConnection(store().db, id); return ok(null) })

  handle('history.add', (entry) => ok(hist.addHistory(store().db, entry)))
  handle('history.list', ({ connectionId, limit }) => ok(hist.listHistory(store().db, connectionId, limit)))

  handle('settings.get', () => ok(settings.getSettings(store().db)))
  handle('settings.set', ({ key, value }) => {
    const { db } = store()
    settings.setSetting(db, key, value)
    return ok(settings.getSettings(db))
  })
  handle('settings.dataDir.get', () => ok(settings.getCurrentDataDir()))
  handle('settings.dataDir.set', (dir) => { settings.relocateDataDir(dir); openDb(); return ok(dir) })
}
