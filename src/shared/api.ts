import type { IpcResult } from './ipc'
import type { ConnectionInput, HistoryEntryInput, SavedQueryInput, SavedQueryPatch, SessionTab } from './domain'
import type { ObjectRef } from './schema'

export interface DbClientApi {
  ping(message: string): Promise<IpcResult<'ping'>>
  connections: {
    list(): Promise<IpcResult<'connections.list'>>
    get(id: string): Promise<IpcResult<'connections.get'>>
    create(input: ConnectionInput, password: string | null, sshSecrets?: Record<string, string>): Promise<IpcResult<'connections.create'>>
    update(id: string, patch: Partial<ConnectionInput>, password?: string | null, sshSecrets?: Record<string, string>): Promise<IpcResult<'connections.update'>>
    delete(id: string): Promise<IpcResult<'connections.delete'>>
    test(input: ConnectionInput, password: string | null, id?: string, sshSecrets?: Record<string, string>): Promise<IpcResult<'connections.test'>>
    disconnect(id: string): Promise<IpcResult<'connections.disconnect'>>
  }
  history: {
    add(entry: HistoryEntryInput): Promise<IpcResult<'history.add'>>
    list(connectionId: string, limit?: number): Promise<IpcResult<'history.list'>>
  }
  savedQueries: {
    list(connectionId: string): Promise<IpcResult<'savedQueries.list'>>
    create(input: SavedQueryInput): Promise<IpcResult<'savedQueries.create'>>
    update(id: string, patch: SavedQueryPatch): Promise<IpcResult<'savedQueries.update'>>
    delete(id: string): Promise<IpcResult<'savedQueries.delete'>>
  }
  session: {
    tabs(): Promise<IpcResult<'session.tabs'>>
    saveTabs(tabs: SessionTab[]): Promise<IpcResult<'session.saveTabs'>>
  }
  settings: {
    get(): Promise<IpcResult<'settings.get'>>
    set(key: string, value: string): Promise<IpcResult<'settings.set'>>
    getDataDir(): Promise<IpcResult<'settings.dataDir.get'>>
    setDataDir(dir: string): Promise<IpcResult<'settings.dataDir.set'>>
  }
  query: {
    run(connectionId: string, query: string, queryId: string): Promise<IpcResult<'query.run'>>
    cancel(connectionId: string, queryId: string): Promise<IpcResult<'query.cancel'>>
  }
  schema: {
    objects(connectionId: string): Promise<IpcResult<'schema.objects'>>
    columns(connectionId: string, ref: ObjectRef): Promise<IpcResult<'schema.columns'>>
  }
  clipboard: {
    copy(text: string): Promise<IpcResult<'clipboard.copy'>>
  }
  dialog: {
    pickDirectory(): Promise<IpcResult<'dialog.pickDirectory'>>
    openFile(title?: string): Promise<IpcResult<'dialog.openFile'>>
  }
}
