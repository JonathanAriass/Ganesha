import { contextBridge, ipcRenderer } from 'electron'
import type { ChannelName, Req, IpcResult } from '../shared/ipc'
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
    columns: (connectionId, ref) => invoke('schema.columns', { connectionId, ref })
  },
  clipboard: {
    copy: (text) => invoke('clipboard.copy', text)
  },
  dialog: {
    pickDirectory: () => invoke('dialog.pickDirectory', undefined),
    openFile: (title) => invoke('dialog.openFile', { title })
  }
}

contextBridge.exposeInMainWorld('api', api)
