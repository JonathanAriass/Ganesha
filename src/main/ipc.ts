import { ipcMain, clipboard, dialog, BrowserWindow } from 'electron'
import type { ChannelName, Req, Res } from '../shared/ipc'
import type { ConnectionConfig } from '../shared/domain'
import { ok, err, type Result } from '../shared/result'
import { openDb } from './persistence/db'
import { safeStorageEncryptor, makeSecretStore, resolveTestPassword } from './persistence/secrets'
import * as conns from './persistence/connections'
import * as hist from './persistence/history'
import * as saved from './persistence/saved-queries'
import * as sess from './persistence/session'
import * as settings from './persistence/settings'
import { DriverManager } from './drivers/registry'
import { PostgresDriver } from './drivers/sql/postgres'
import { MySqlDriver } from './drivers/sql/mysql'
import { MongoDriver } from './drivers/mongo/mongo'
import { runUserQuery } from './query-service'
import { SshTunnelManager } from './ssh/tunnel-manager'
import { connectVia, disconnectVia, openTunnel } from './connection-runtime'
import { buildConnectParams } from './drivers/params'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { LlmEngine } from './llm/engine'
import { MODEL_CATALOG } from './llm/catalog'
import { listLocalModels, deleteLocalModel, downloadModel } from './llm/models'
import { buildSchemaContext } from './llm/schema-context'
import * as llm from './persistence/llm'
import { getModelsDir } from './persistence/paths'
import type { LlmTokenEvent, LlmDownloadEvent } from '../shared/ipc'

const drivers = new DriverManager()
drivers.register(new PostgresDriver())
drivers.register(new MySqlDriver('mysql'))
drivers.register(new MySqlDriver('mariadb'))
drivers.register(new MongoDriver())

const tunnels = new SshTunnelManager()
const engine = new LlmEngine()
const activeGenerations = new Map<string, AbortController>()

/** Close every live SSH tunnel — called on app quit. */
export function closeAllTunnels(): Promise<void> {
  return tunnels.closeAll()
}

/** Free the loaded LLM model (native memory) — called on app quit. */
export function unloadLlm(): Promise<void> {
  return engine.unload()
}

/** Persist the SSH secrets the user typed this save, keyed `ssh:<hopId>`. Blank
 *  ones are absent from the map (the renderer only sends typed values) → keep existing. */
function writeSshSecrets(secrets: ReturnType<typeof makeSecretStore>, connId: string, sshSecrets?: Record<string, string>): void {
  if (!sshSecrets) return
  for (const [hopId, value] of Object.entries(sshSecrets)) {
    if (value !== '') secrets.setSecret(connId, `ssh:${hopId}`, value)
  }
}

/** Connect a connection's driver through its SSH tunnel (if enabled), resolving
 *  hop secrets from the store. */
function connectStored(driver: ReturnType<DriverManager['get']>, config: ConnectionConfig, secrets: ReturnType<typeof makeSecretStore>): Promise<void> {
  return connectVia(driver, config, {
    tunnels,
    readFile: (p) => readFileSync(p),
    getHopSecret: (hopId) => secrets.getSecret(config.id, `ssh:${hopId}`),
    dbPassword: secrets.getPassword(config.id)
  })
}

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
  handle('connections.create', ({ input, password, sshSecrets }) => {
    const { db, secrets } = store()
    const c = conns.createConnection(db, input, now())
    if (password !== null) secrets.setPassword(c.id, password)
    writeSshSecrets(secrets, c.id, sshSecrets)
    return ok(c)
  })
  handle('connections.update', async ({ id, patch, password, sshSecrets }) => {
    const { db, secrets } = store()
    const before = conns.getConnection(db, id)
    const c = conns.updateConnection(db, id, patch, now())
    // If the type changed, the live pool is registered under the OLD type's driver.
    if (before && before.type !== c.type && drivers.has(before.type)) {
      await disconnectVia(drivers.get(before.type), before, tunnels)
    }
    if (password !== undefined) {
      if (password === null) secrets.deletePassword(id)
      else secrets.setPassword(id, password)
    }
    writeSshSecrets(secrets, id, sshSecrets)
    // Pools keep their original credentials (connect() is idempotent) — drop the live
    // pool AND its tunnel so the next access reconnects with the just-saved config.
    if (drivers.has(c.type)) await disconnectVia(drivers.get(c.type), c, tunnels)
    return ok(c)
  })
  handle('connections.delete', async (id) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, id)
    if (c && drivers.has(c.type)) await disconnectVia(drivers.get(c.type), c, tunnels)
    secrets.deleteAllSecrets(id)
    conns.deleteConnection(db, id)
    return ok(null)
  })

  handle('history.add', (entry) => ok(hist.addHistory(store().db, entry)))
  handle('history.list', ({ connectionId, limit }) => ok(hist.listHistory(store().db, connectionId, limit)))

  handle('savedQueries.list', (connectionId) => ok(saved.listSavedQueries(store().db, connectionId)))
  handle('savedQueries.create', (input) => ok(saved.createSavedQuery(store().db, input, now())))
  handle('savedQueries.update', ({ id, patch }) => ok(saved.updateSavedQuery(store().db, id, patch, now())))
  handle('savedQueries.delete', (id) => { saved.deleteSavedQuery(store().db, id); return ok(null) })

  handle('session.tabs', () => ok(sess.listSessionTabs(store().db)))
  handle('session.saveTabs', (tabs) => { sess.saveSessionTabs(store().db, tabs); return ok(null) })

  handle('settings.get', () => ok(settings.getSettings(store().db)))
  handle('settings.set', ({ key, value }) => {
    const { db } = store()
    settings.setSetting(db, key, value)
    return ok(settings.getSettings(db))
  })
  handle('settings.dataDir.get', () => ok(settings.getCurrentDataDir()))
  handle('settings.dataDir.set', (dir) => { settings.relocateDataDir(dir); void openDb(); return ok(dir) })

  handle('connections.test', async ({ input, password, id, sshSecrets }) => {
    // Edit-mode Test with a blank password means "test with the saved password" —
    // resolve the stored secret here in main; it never crosses to the renderer.
    const { secrets } = store()
    const pwd = resolveTestPassword(password, id, secrets)
    const driver = drivers.get(input.type)
    // Throwaway pooled connection under a test id, brought up through the tunnel
    // (typed SSH secrets win; blank-on-edit falls back to the stored ones).
    const testId = `test:${id ?? 'new'}`
    const config: ConnectionConfig = { ...input, id: testId, createdAt: 0, updatedAt: 0 }
    try {
      // Open the tunnel (if any), then a REAL connectivity probe through it.
      // testConnection actually dials + runs SELECT 1 / ping — the lazy pooled
      // connect() does not, so it must not stand in for the probe here.
      const endpoint = await openTunnel(config, {
        tunnels,
        readFile: (p) => readFileSync(p),
        getHopSecret: (hopId) => sshSecrets?.[hopId] || (id ? secrets.getSecret(id, `ssh:${hopId}`) : null),
        dbPassword: pwd
      })
      await driver.testConnection(buildConnectParams(config, pwd, endpoint))
    } finally {
      await tunnels.close(testId)
    }
    return ok(null)
  })
  handle('connections.disconnect', async (id) => {
    const c = conns.getConnection(store().db, id)
    if (c && drivers.has(c.type)) await disconnectVia(drivers.get(c.type), c, tunnels)
    return ok(null)
  })
  handle('query.run', async ({ connectionId, query, queryId }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const result = await runUserQuery({ db, secrets, driver: drivers.get(c.type), connectionId, query, queryId, tunnels, now: () => Date.now() })
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
    await connectStored(driver, c, secrets)
    return ok(await driver.listObjects(c.id))
  })
  handle('schema.databases', async (connectionId) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const driver = drivers.get(c.type)
    await connectStored(driver, c, secrets)
    return ok(await driver.listDatabases(c.id))
  })
  handle('schema.columns', async ({ connectionId, ref }) => {
    const { db, secrets } = store()
    const c = conns.getConnection(db, connectionId)
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    const driver = drivers.get(c.type)
    await connectStored(driver, c, secrets)
    return ok(await driver.describeObject(c.id, ref))
  })

  // navigator.clipboard is permission-gated in the sandboxed renderer; route via main.
  handle('clipboard.copy', (text) => { clipboard.writeText(text); return ok(null) })

  handle('dialog.pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return ok(r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0])
  })

  handle('dialog.openFile', async ({ title }) => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title, properties: ['openFile'] as Array<'openFile'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return ok(r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0])
  })

  // ── Local LLM assistant ──
  handle('llm.models.list', () => {
    const { db } = store()
    return ok({ downloaded: listLocalModels(getModelsDir()), catalog: MODEL_CATALOG, activeModelId: settings.getSetting(db, 'llm.activeModel') })
  })
  handle('llm.models.delete', ({ id }) => { deleteLocalModel(getModelsDir(), id); return ok(null) })
  handle('llm.models.setActive', ({ id }) => { settings.setSetting(store().db, 'llm.activeModel', id); return ok(null) })
  handle('llm.conversations.list', ({ connectionId }) => ok(llm.listConversations(store().db, connectionId)))
  handle('llm.conversations.create', ({ connectionId, title }) => ok(llm.createConversation(store().db, connectionId, title, now())))
  handle('llm.conversations.delete', ({ id }) => { llm.deleteConversation(store().db, id); return ok(null) })
  handle('llm.messages.list', ({ conversationId }) => ok(llm.listMessages(store().db, conversationId)))
  handle('llm.chat.cancel', ({ requestId }) => { activeGenerations.get(requestId)?.abort(); return ok(null) })

  // Download streams progress to the renderer that asked — registered raw for event.sender.
  ipcMain.handle('llm.models.download', async (event, { uri }: { uri: string }) => {
    const push = (ev: LlmDownloadEvent): void => { if (!event.sender.isDestroyed()) event.sender.send('llm:download', ev) }
    try {
      await downloadModel(getModelsDir(), uri, (receivedBytes, totalBytes) => push({ uri, receivedBytes, totalBytes }))
      push({ uri, done: true })
      return ok(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      push({ uri, error: message })
      return err(message)
    }
  })

  // Chat: stream tokens, persisting the turn only once generation has actually
  // started — so a failure during setup (no model / bad connection / model load)
  // never leaves an orphaned user message that would double-feed the model next time.
  ipcMain.handle('llm.chat.send', async (event, { conversationId, connectionId, prompt }: { conversationId: string; connectionId: string; prompt: string }) => {
    const { db, secrets } = store()
    const requestId = randomUUID()
    // The webContents can be torn down mid-stream (window closed) — guard the push.
    const send = (ev: LlmTokenEvent): void => { if (!event.sender.isDestroyed()) event.sender.send('llm:token', ev) }
    try {
      const activeModelId = settings.getSetting(db, 'llm.activeModel')
      const models = listLocalModels(getModelsDir())
      const model = models.find((m) => m.id === activeModelId) ?? models[0]
      if (!model) throw new Error('No model downloaded — open the model manager to download one.')

      const config = conns.getConnection(db, connectionId)
      if (!config) throw new Error(`Connection not found: ${connectionId}`)

      // Ground the prompt with the live schema (through the SSH tunnel if any).
      const driver = drivers.get(config.type)
      await connectStored(driver, config, secrets)
      const dbObjects = await driver.listObjects(config.id)
      const withCols = await Promise.all(dbObjects.map(async (o) => ({
        object: o,
        columns: await driver.describeObject(config.id, { schema: o.schema, name: o.name }).catch(() => [])
      })))
      const systemPrompt =
        'You are a database query assistant. Recommend correct queries for the user\'s database. ' +
        'Return runnable queries in fenced code blocks (```sql, or ```js for MongoDB). Be concise.\n\n' +
        buildSchemaContext(config.type, withCols)

      // Prior turns BEFORE this one, then load the model. Both happen before we
      // persist anything, so a setup failure leaves the conversation untouched.
      const history = llm.listMessages(db, conversationId)
      await engine.load(model.path)

      // Commit the turn: from here every user message gets a paired assistant
      // message (real answer, partial on Stop, or an error note) — the thread
      // never ends on a dangling user turn.
      llm.addMessage(db, conversationId, 'user', prompt, now())
      llm.touchConversation(db, conversationId, now())
      const ac = new AbortController()
      activeGenerations.set(requestId, ac)
      // Stream in the background; the invoke resolves immediately with the id.
      void engine.generate(systemPrompt, history, prompt, (chunk) => send({ requestId, chunk }), ac.signal)
        .then((full) => { llm.addMessage(db, conversationId, 'assistant', full, now()); llm.touchConversation(db, conversationId, now()); send({ requestId, done: true }) })
        .catch((e) => {
          const message = e instanceof Error ? e.message : String(e)
          llm.addMessage(db, conversationId, 'assistant', `⚠️ Generation failed: ${message}`, now())
          send({ requestId, error: message })
        })
        .finally(() => activeGenerations.delete(requestId))

      return ok({ requestId })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      send({ requestId, error: message })
      return err(message)
    }
  })
}
