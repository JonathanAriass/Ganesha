import type { Result } from './result'
import type {
  ConnectionConfig, ConnectionInput, HistoryEntry, HistoryEntryInput, AppSettings,
  SavedQuery, SavedQueryInput, SavedQueryPatch
} from './domain'
import type { QueryResult } from './query'
import type { DbObject, ObjectRef, ColumnInfo } from './schema'

export interface PingPayload {
  pong: string
}

/**
 * The single source of truth for IPC channels. `req` is the renderer→main
 * argument; `res` is the success payload (delivered wrapped in Result<res>).
 */
export interface IpcChannels {
  ping: { req: string; res: PingPayload }
  'connections.list': { req: void; res: ConnectionConfig[] }
  'connections.get': { req: string; res: ConnectionConfig | null }
  'connections.create': { req: { input: ConnectionInput; password: string | null }; res: ConnectionConfig }
  'connections.update': { req: { id: string; patch: Partial<ConnectionInput>; password?: string | null }; res: ConnectionConfig }
  'connections.delete': { req: string; res: null }
  'history.add': { req: HistoryEntryInput; res: HistoryEntry }
  'history.list': { req: { connectionId: string; limit?: number }; res: HistoryEntry[] }
  'savedQueries.list': { req: string; res: SavedQuery[] }
  'savedQueries.create': { req: SavedQueryInput; res: SavedQuery }
  'savedQueries.update': { req: { id: string; patch: SavedQueryPatch }; res: SavedQuery }
  'savedQueries.delete': { req: string; res: null }
  'settings.get': { req: void; res: AppSettings }
  'settings.set': { req: { key: string; value: string }; res: AppSettings }
  'settings.dataDir.get': { req: void; res: string }
  'settings.dataDir.set': { req: string; res: string }
  'query.run': { req: { connectionId: string; query: string; queryId: string }; res: QueryResult }
  'query.cancel': { req: { connectionId: string; queryId: string }; res: null }
  'connections.test': { req: { input: ConnectionInput; password: string | null; id?: string }; res: null }
  'connections.disconnect': { req: string; res: null }
  'schema.objects': { req: string; res: DbObject[] }
  'schema.columns': { req: { connectionId: string; ref: ObjectRef }; res: ColumnInfo[] }
  'clipboard.copy': { req: string; res: null }
  'dialog.pickDirectory': { req: void; res: string | null }
}

export type ChannelName = keyof IpcChannels
export type Req<K extends ChannelName> = IpcChannels[K]['req']
export type Res<K extends ChannelName> = IpcChannels[K]['res']
export type IpcResult<K extends ChannelName> = Result<Res<K>>
