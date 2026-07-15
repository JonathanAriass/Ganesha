import type { Result } from './result'
import type {
  ConnectionConfig, ConnectionInput, HistoryEntry, HistoryEntryInput, AppSettings,
  SavedQuery, SavedQueryInput, SavedQueryPatch, SessionTab,
  LocalModel, CatalogModel, LlmConversation, LlmMessage, SsmTunnel, SsmTunnelInput, AwsInstance
} from './domain'
import type { QueryResult, RowEdit } from './query'
import type { DbObject, ObjectRef, ColumnInfo, Relationship, TableColumns, TableInfo } from './schema'

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
  'connections.create': { req: { input: ConnectionInput; password: string | null; sshSecrets?: Record<string, string> }; res: ConnectionConfig }
  'connections.update': { req: { id: string; patch: Partial<ConnectionInput>; password?: string | null; sshSecrets?: Record<string, string> }; res: ConnectionConfig }
  'connections.delete': { req: string; res: null }
  'history.add': { req: HistoryEntryInput; res: HistoryEntry }
  'history.list': { req: { connectionId: string; limit?: number }; res: HistoryEntry[] }
  'savedQueries.list': { req: string; res: SavedQuery[] }
  'savedQueries.create': { req: SavedQueryInput; res: SavedQuery }
  'savedQueries.update': { req: { id: string; patch: SavedQueryPatch }; res: SavedQuery }
  'savedQueries.delete': { req: string; res: null }
  'session.tabs': { req: void; res: SessionTab[] }
  'session.saveTabs': { req: SessionTab[]; res: null }
  'settings.get': { req: void; res: AppSettings }
  'settings.set': { req: { key: string; value: string }; res: AppSettings }
  'settings.dataDir.get': { req: void; res: string }
  'settings.dataDir.set': { req: string; res: string }
  'query.run': { req: { connectionId: string; query: string; queryId: string }; res: QueryResult }
  'query.cancel': { req: { connectionId: string; queryId: string }; res: null }
  'query.fetchMore': { req: { queryId: string; offset: number }; res: { rows: unknown[][]; documents: Record<string, unknown>[] | null; hasMore: boolean } }
  'connections.test': { req: { input: ConnectionInput; password: string | null; id?: string; sshSecrets?: Record<string, string> }; res: null }
  'connections.disconnect': { req: string; res: null }
  'schema.objects': { req: string; res: DbObject[] }
  'schema.databases': { req: string; res: string[] }
  'schema.columns': { req: { connectionId: string; ref: ObjectRef }; res: ColumnInfo[] }
  'schema.allColumns': { req: string; res: TableColumns[] }
  'schema.relationships': { req: string; res: Relationship[] }
  'schema.tableInfo': { req: { connectionId: string; ref: ObjectRef }; res: TableInfo }
  'edits.apply': {
    req: { connectionId: string; table: { schema: string | null; name: string }; rows: RowEdit[] }
    res: { updated: number }
  }
  'clipboard.copy': { req: string; res: null }
  'dialog.pickDirectory': { req: void; res: string | null }
  'dialog.openFile': { req: { title?: string }; res: string | null }
  'llm.models.list': { req: void; res: { downloaded: LocalModel[]; catalog: CatalogModel[]; activeModelId: string | null } }
  'llm.models.download': { req: { uri: string }; res: null }
  'llm.models.delete': { req: { id: string }; res: null }
  'llm.models.setActive': { req: { id: string }; res: null }
  'llm.conversations.list': { req: { connectionId: string }; res: LlmConversation[] }
  'llm.conversations.create': { req: { connectionId: string; title: string }; res: LlmConversation }
  'llm.conversations.delete': { req: { id: string }; res: null }
  'llm.messages.list': { req: { conversationId: string }; res: LlmMessage[] }
  'llm.chat.send': { req: { conversationId: string; connectionId: string; prompt: string; queryText?: string }; res: { requestId: string } }
  'llm.chat.cancel': { req: { requestId: string }; res: null }
  'ssm.list': { req: void; res: SsmTunnel[] }
  'ssm.create': { req: SsmTunnelInput; res: SsmTunnel }
  'ssm.update': { req: { id: string; patch: Partial<SsmTunnelInput> }; res: SsmTunnel }
  'ssm.delete': { req: string; res: null }
  'ssm.start': { req: string; res: null }
  'ssm.stop': { req: string; res: null }
  'ssm.running': { req: void; res: string[] }
  'aws.profiles': { req: void; res: string[] }
  'aws.identity': { req: { profile: string; region: string }; res: { arn: string } }
  'aws.login': { req: { profile: string }; res: null }
  'aws.instances': { req: { profile: string; region: string }; res: AwsInstance[] }
}

/** main→renderer push payload for streamed chat tokens. */
export interface LlmTokenEvent { requestId: string; chunk?: string; done?: boolean; error?: string }
/** main→renderer push payload for model download progress. */
export interface LlmDownloadEvent { uri: string; receivedBytes?: number; totalBytes?: number; done?: boolean; error?: string }
/** One linked-repo file that grounded a chat turn: its path, the table that pulled it in, and the
 *  exact snippet injected into the prompt (so the UI can show what the model actually saw). */
export interface LlmContextFile { path: string; table: string; snippet: string }
/** main→renderer push payload listing the linked-repo files used to ground one chat turn. */
export interface LlmContextEvent { requestId: string; files: LlmContextFile[] }
/** main->renderer push payloads for SSM tunnel processes. */
export interface SsmOutputEvent { id: string; chunk: string }
export interface SsmStatusEvent { id: string; running: boolean; code: number | null; ready?: boolean }

export type ChannelName = keyof IpcChannels
export type Req<K extends ChannelName> = IpcChannels[K]['req']
export type Res<K extends ChannelName> = IpcChannels[K]['res']
export type IpcResult<K extends ChannelName> = Result<Res<K>>
