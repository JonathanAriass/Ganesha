import type { IpcResult } from './ipc'
import type { ConnectionInput, HistoryEntryInput } from './domain'

export interface DbClientApi {
  ping(message: string): Promise<IpcResult<'ping'>>
  connections: {
    list(): Promise<IpcResult<'connections.list'>>
    get(id: string): Promise<IpcResult<'connections.get'>>
    create(input: ConnectionInput, password: string | null): Promise<IpcResult<'connections.create'>>
    update(id: string, patch: Partial<ConnectionInput>, password?: string | null): Promise<IpcResult<'connections.update'>>
    delete(id: string): Promise<IpcResult<'connections.delete'>>
    test(input: ConnectionInput, password: string | null): Promise<IpcResult<'connections.test'>>
    disconnect(id: string): Promise<IpcResult<'connections.disconnect'>>
  }
  history: {
    add(entry: HistoryEntryInput): Promise<IpcResult<'history.add'>>
    list(connectionId: string, limit?: number): Promise<IpcResult<'history.list'>>
  }
  settings: {
    get(): Promise<IpcResult<'settings.get'>>
    set(key: string, value: string): Promise<IpcResult<'settings.set'>>
    getDataDir(): Promise<IpcResult<'settings.dataDir.get'>>
    setDataDir(dir: string): Promise<IpcResult<'settings.dataDir.set'>>
  }
  query: {
    run(connectionId: string, query: string): Promise<IpcResult<'query.run'>>
    cancel(connectionId: string, queryId: string): Promise<IpcResult<'query.cancel'>>
  }
}
