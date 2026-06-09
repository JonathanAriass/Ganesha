import type { IpcResult } from './ipc'

export interface DbClientApi {
  ping(message: string): Promise<IpcResult<'ping'>>
}
