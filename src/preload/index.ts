import { contextBridge, ipcRenderer } from 'electron'
import type { ChannelName, Req, IpcResult, LlmTokenEvent, LlmDownloadEvent, LlmContextEvent, SsmOutputEvent, SsmStatusEvent } from '../shared/ipc'
import type { DbClientApi } from '../shared/api'

function invoke<K extends ChannelName>(channel: K, req: Req<K>): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, req)
}

const api: DbClientApi = {
  ping: (message) => invoke('ping', message),
  connections: {
    list: () => invoke('connections.list', undefined),
    get: (id) => invoke('connections.get', id),
    create: (input, password, sshSecrets) => invoke('connections.create', { input, password, sshSecrets }),
    update: (id, patch, password, sshSecrets) => invoke('connections.update', { id, patch, password, sshSecrets }),
    delete: (id) => invoke('connections.delete', id),
    test: (input, password, id, sshSecrets) => invoke('connections.test', { input, password, id, sshSecrets }),
    disconnect: (id) => invoke('connections.disconnect', id)
  },
  history: {
    add: (entry) => invoke('history.add', entry),
    list: (connectionId, limit) => invoke('history.list', { connectionId, limit })
  },
  savedQueries: {
    list: (connectionId) => invoke('savedQueries.list', connectionId),
    create: (input) => invoke('savedQueries.create', input),
    update: (id, patch) => invoke('savedQueries.update', { id, patch }),
    delete: (id) => invoke('savedQueries.delete', id)
  },
  session: {
    tabs: () => invoke('session.tabs', undefined),
    saveTabs: (tabs) => invoke('session.saveTabs', tabs)
  },
  settings: {
    get: () => invoke('settings.get', undefined),
    set: (key, value) => invoke('settings.set', { key, value }),
    getDataDir: () => invoke('settings.dataDir.get', undefined),
    setDataDir: (dir) => invoke('settings.dataDir.set', dir)
  },
  query: {
    run: (connectionId, query, queryId) => invoke('query.run', { connectionId, query, queryId }),
    cancel: (connectionId, queryId) => invoke('query.cancel', { connectionId, queryId })
  },
  schema: {
    objects: (connectionId) => invoke('schema.objects', connectionId),
    databases: (connectionId) => invoke('schema.databases', connectionId),
    columns: (connectionId, ref) => invoke('schema.columns', { connectionId, ref }),
    allColumns: (connectionId) => invoke('schema.allColumns', connectionId),
    relationships: (connectionId) => invoke('schema.relationships', connectionId)
  },
  edits: {
    apply: (req) => invoke('edits.apply', req)
  },
  clipboard: {
    copy: (text) => invoke('clipboard.copy', text)
  },
  dialog: {
    pickDirectory: () => invoke('dialog.pickDirectory', undefined),
    openFile: (title) => invoke('dialog.openFile', { title })
  },
  llm: {
    listModels: () => invoke('llm.models.list', undefined),
    downloadModel: (uri) => invoke('llm.models.download', { uri }),
    deleteModel: (id) => invoke('llm.models.delete', { id }),
    setActiveModel: (id) => invoke('llm.models.setActive', { id }),
    listConversations: (connectionId) => invoke('llm.conversations.list', { connectionId }),
    createConversation: (connectionId, title) => invoke('llm.conversations.create', { connectionId, title }),
    deleteConversation: (id) => invoke('llm.conversations.delete', { id }),
    listMessages: (conversationId) => invoke('llm.messages.list', { conversationId }),
    send: (conversationId, connectionId, prompt, queryText) =>
      invoke('llm.chat.send', { conversationId, connectionId, prompt, queryText }),
    cancel: (requestId) => invoke('llm.chat.cancel', { requestId }),
    onToken: (cb) => {
      const l = (_e: unknown, payload: LlmTokenEvent): void => cb(payload)
      ipcRenderer.on('llm:token', l)
      return () => ipcRenderer.removeListener('llm:token', l)
    },
    onContext: (cb) => {
      const l = (_e: unknown, payload: LlmContextEvent): void => cb(payload)
      ipcRenderer.on('llm:context', l)
      return () => ipcRenderer.removeListener('llm:context', l)
    },
    onDownloadProgress: (cb) => {
      const l = (_e: unknown, payload: LlmDownloadEvent): void => cb(payload)
      ipcRenderer.on('llm:download', l)
      return () => ipcRenderer.removeListener('llm:download', l)
    }
  },
  ssm: {
    list: () => invoke('ssm.list', undefined),
    create: (input) => invoke('ssm.create', input),
    update: (id, patch) => invoke('ssm.update', { id, patch }),
    delete: (id) => invoke('ssm.delete', id),
    start: (id) => invoke('ssm.start', id),
    stop: (id) => invoke('ssm.stop', id),
    running: () => invoke('ssm.running', undefined),
    onOutput: (cb) => {
      const l = (_e: unknown, payload: SsmOutputEvent): void => cb(payload)
      ipcRenderer.on('ssm:output', l)
      return () => ipcRenderer.removeListener('ssm:output', l)
    },
    onStatus: (cb) => {
      const l = (_e: unknown, payload: SsmStatusEvent): void => cb(payload)
      ipcRenderer.on('ssm:status', l)
      return () => ipcRenderer.removeListener('ssm:status', l)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
