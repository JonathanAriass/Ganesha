import type { Result } from './result'
import type {
  ConnectionConfig, ConnectionInput, HistoryEntry, HistoryEntryInput, AppSettings
} from './domain'

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
  'settings.get': { req: void; res: AppSettings }
  'settings.set': { req: { key: string; value: string }; res: AppSettings }
  'settings.dataDir.get': { req: void; res: string }
  'settings.dataDir.set': { req: string; res: string }
}

export type ChannelName = keyof IpcChannels
export type Req<K extends ChannelName> = IpcChannels[K]['req']
export type Res<K extends ChannelName> = IpcChannels[K]['res']
export type IpcResult<K extends ChannelName> = Result<Res<K>>
