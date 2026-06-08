import { ipcMain } from 'electron'
import { IPC, type PingResult } from '../shared/ipc'
import { ok } from '../shared/result'

/** Register every main-process IPC handler. Called once on app ready. */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.ping, (_event, message: string): PingResult => {
    return ok({ pong: message })
  })
}
