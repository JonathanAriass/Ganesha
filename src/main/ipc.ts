import { ipcMain } from 'electron'
import type { ChannelName, Req, Res } from '../shared/ipc'
import { ok, err, type Result } from '../shared/result'

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

/** Register every main-process IPC handler. Called once on app ready. */
export function registerIpcHandlers(): void {
  handle('ping', (message) => ok({ pong: message }))
}
