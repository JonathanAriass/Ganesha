import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PingResult } from '../shared/ipc'
import type { DbClientApi } from '../shared/api'

const api: DbClientApi = {
  ping: (message: string): Promise<PingResult> => ipcRenderer.invoke(IPC.ping, message)
}

contextBridge.exposeInMainWorld('api', api)
