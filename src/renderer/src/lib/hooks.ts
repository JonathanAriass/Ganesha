import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConnectionInput, SavedQueryInput, SavedQueryPatch } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'
import { unwrap } from './result'
import type { QueryResult } from '@shared/query'
import { useAppStore } from '../state/store'

// ── Connections ──────────────────────────────────────────────────────────────

export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: () => window.api.connections.list().then(unwrap),
    retry: false,
  })
}

// ── Schema: objects ──────────────────────────────────────────────────────────

export function useObjects(connectionId: string | null) {
  return useQuery({
    queryKey: ['objects', connectionId],
    queryFn: () => window.api.schema.objects(connectionId!).then(unwrap),
    enabled: connectionId != null,
    retry: false,
  })
}

// ── Schema: columns (lazy) ───────────────────────────────────────────────────

export function useColumns(
  connectionId: string | null,
  ref: ObjectRef,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['columns', connectionId, ref.schema, ref.name],
    queryFn: () =>
      window.api.schema.columns(connectionId!, ref).then(unwrap),
    enabled: enabled && connectionId != null,
    retry: false,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useSaveConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
      password,
    }: {
      id?: string
      input: ConnectionInput
      password: string | undefined | null
    }) => {
      if (id) {
        // Update: undefined password means "keep existing"
        return window.api.connections
          .update(id, input, password === '' ? undefined : password)
          .then(unwrap)
      } else {
        // Create: null means no password
        return window.api.connections
          .create(input, password ?? null)
          .then(unwrap)
      }
    },
    onSuccess: () => {
      // Saved config (host/creds/db) may change what's visible — refetch the tree too.
      void qc.invalidateQueries({ queryKey: ['connections'] })
      void qc.invalidateQueries({ queryKey: ['objects'] })
      void qc.invalidateQueries({ queryKey: ['columns'] })
    },
  })
}

export function useDeleteConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      window.api.connections.delete(id).then(unwrap),
    onSuccess: (_d, id) => {
      // Tabs pointing at the deleted connection would linger with a dead Run.
      useAppStore.getState().closeTabsForConnection(id)
      void qc.invalidateQueries({ queryKey: ['connections'] })
      void qc.invalidateQueries({ queryKey: ['objects'] })
      void qc.invalidateQueries({ queryKey: ['columns'] })
    },
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: ({
      input,
      password,
      id,
    }: {
      input: ConnectionInput
      password: string | null
      id?: string
    }) => window.api.connections.test(input, password, id).then(unwrap),
  })
}

export function useRunQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, query, queryId }: { connectionId: string; query: string; queryId: string }): Promise<QueryResult> =>
      window.api.query.run(connectionId, query, queryId).then(unwrap),
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ['history', vars.connectionId] })
    },
  })
}

export function useCancelQuery() {
  return useMutation({
    mutationFn: ({ connectionId, queryId }: { connectionId: string; queryId: string }) =>
      window.api.query.cancel(connectionId, queryId).then(unwrap),
  })
}

export function useHistory(connectionId: string | null) {
  return useQuery({
    queryKey: ['history', connectionId],
    queryFn: () => window.api.history.list(connectionId!, 50).then(unwrap),
    enabled: connectionId != null,
    retry: false,
  })
}

// ── Saved queries ────────────────────────────────────────────────────────────

export function useSavedQueries(connectionId: string | null) {
  return useQuery({
    queryKey: ['savedQueries', connectionId],
    queryFn: () => window.api.savedQueries.list(connectionId!).then(unwrap),
    enabled: connectionId != null,
    retry: false,
  })
}

export function useCreateSavedQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SavedQueryInput) =>
      window.api.savedQueries.create(input).then(unwrap),
    onSuccess: (q) =>
      void qc.invalidateQueries({ queryKey: ['savedQueries', q.connectionId] }),
  })
}

export function useUpdateSavedQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SavedQueryPatch }) =>
      window.api.savedQueries.update(id, patch).then(unwrap),
    onSuccess: (q) =>
      void qc.invalidateQueries({ queryKey: ['savedQueries', q.connectionId] }),
  })
}

export function useDeleteSavedQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => window.api.savedQueries.delete(id).then(unwrap),
    // Only the id is known here — invalidate every connection's list.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['savedQueries'] }),
  })
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.get().then(unwrap),
    retry: false,
  })
}

export function useSetSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      window.api.settings.set(key, value).then(unwrap),
    // settings.set returns the full updated AppSettings — write it straight into the cache.
    onSuccess: (settings) => qc.setQueryData(['settings'], settings),
  })
}

export function useDataDir() {
  return useQuery({
    queryKey: ['dataDir'],
    queryFn: () => window.api.settings.getDataDir().then(unwrap),
    retry: false,
  })
}

export function useSetDataDir() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dir: string) => window.api.settings.setDataDir(dir).then(unwrap),
    // Relocation swaps the underlying database file — every cached read is stale.
    onSuccess: () => void qc.invalidateQueries(),
  })
}
