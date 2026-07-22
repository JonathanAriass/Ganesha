import type { IpcResult, LlmTokenEvent, LlmDownloadEvent, LlmContextEvent, SsmOutputEvent, SsmStatusEvent } from './ipc'
import type { ConnectionInput, HistoryEntryInput, SavedQueryInput, SavedQueryPatch, SessionTab, SsmTunnelInput } from './domain'
import type { ObjectRef } from './schema'
import type { FilterQuery } from './query'
import type { TelescopeFilter } from './telescope'

export interface DbClientApi {
  ping(message: string): Promise<IpcResult<'ping'>>
  connections: {
    list(): Promise<IpcResult<'connections.list'>>
    get(id: string): Promise<IpcResult<'connections.get'>>
    create(input: ConnectionInput, password: string | null, sshSecrets?: Record<string, string>): Promise<IpcResult<'connections.create'>>
    update(id: string, patch: Partial<ConnectionInput>, password?: string | null, sshSecrets?: Record<string, string>): Promise<IpcResult<'connections.update'>>
    delete(id: string): Promise<IpcResult<'connections.delete'>>
    duplicate(id: string): Promise<IpcResult<'connections.duplicate'>>
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
    fetchMore(queryId: string, offset: number): Promise<IpcResult<'query.fetchMore'>>
    filter(queryId: string, query: FilterQuery, offset: number): Promise<IpcResult<'query.filter'>>
  }
  schema: {
    objects(connectionId: string): Promise<IpcResult<'schema.objects'>>
    databases(connectionId: string): Promise<IpcResult<'schema.databases'>>
    columns(connectionId: string, ref: ObjectRef): Promise<IpcResult<'schema.columns'>>
    allColumns(connectionId: string): Promise<IpcResult<'schema.allColumns'>>
    relationships(connectionId: string): Promise<IpcResult<'schema.relationships'>>
    tableInfo(connectionId: string, ref: ObjectRef): Promise<IpcResult<'schema.tableInfo'>>
  }
  telescope: {
    detect(connectionId: string): Promise<IpcResult<'telescope.detect'>>
    entries(req: { connectionId: string } & TelescopeFilter): Promise<IpcResult<'telescope.entries'>>
    entry(connectionId: string, uuid: string): Promise<IpcResult<'telescope.entry'>>
    related(connectionId: string, batchId: string, excludeUuid?: string): Promise<IpcResult<'telescope.related'>>
    tags(connectionId: string): Promise<IpcResult<'telescope.tags'>>
  }
  edits: {
    apply(req: {
      connectionId: string
      table: { schema: string | null; name: string }
      rows: import('./query').RowEdit[]
    }): Promise<IpcResult<'edits.apply'>>
  }
  clipboard: {
    copy(text: string): Promise<IpcResult<'clipboard.copy'>>
  }
  dialog: {
    pickDirectory(): Promise<IpcResult<'dialog.pickDirectory'>>
    openFile(title?: string): Promise<IpcResult<'dialog.openFile'>>
  }
  shell: {
    openExternal(url: string): Promise<IpcResult<'shell.openExternal'>>
  }
  update: {
    check(): Promise<IpcResult<'update.check'>>
  }
  llm: {
    listModels(): Promise<IpcResult<'llm.models.list'>>
    downloadModel(uri: string): Promise<IpcResult<'llm.models.download'>>
    deleteModel(id: string): Promise<IpcResult<'llm.models.delete'>>
    setActiveModel(id: string): Promise<IpcResult<'llm.models.setActive'>>
    listConversations(connectionId: string): Promise<IpcResult<'llm.conversations.list'>>
    createConversation(connectionId: string, title: string): Promise<IpcResult<'llm.conversations.create'>>
    deleteConversation(id: string): Promise<IpcResult<'llm.conversations.delete'>>
    listMessages(conversationId: string): Promise<IpcResult<'llm.messages.list'>>
    send(conversationId: string, connectionId: string, prompt: string, queryText?: string): Promise<IpcResult<'llm.chat.send'>>
    cancel(requestId: string): Promise<IpcResult<'llm.chat.cancel'>>
    onToken(cb: (e: LlmTokenEvent) => void): () => void
    onContext(cb: (e: LlmContextEvent) => void): () => void
    onDownloadProgress(cb: (e: LlmDownloadEvent) => void): () => void
  }
  ssm: {
    list(): Promise<IpcResult<'ssm.list'>>
    create(input: SsmTunnelInput): Promise<IpcResult<'ssm.create'>>
    update(id: string, patch: Partial<SsmTunnelInput>): Promise<IpcResult<'ssm.update'>>
    delete(id: string): Promise<IpcResult<'ssm.delete'>>
    start(id: string): Promise<IpcResult<'ssm.start'>>
    stop(id: string): Promise<IpcResult<'ssm.stop'>>
    running(): Promise<IpcResult<'ssm.running'>>
    onOutput(cb: (e: SsmOutputEvent) => void): () => void
    onStatus(cb: (e: SsmStatusEvent) => void): () => void
  }
  aws: {
    profiles(): Promise<IpcResult<'aws.profiles'>>
    identity(profile: string, region: string): Promise<IpcResult<'aws.identity'>>
    login(profile: string): Promise<IpcResult<'aws.login'>>
    instances(profile: string, region: string): Promise<IpcResult<'aws.instances'>>
  }
}
