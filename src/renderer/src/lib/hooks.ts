import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import type { ConnectionInput, SavedQueryInput, SavedQueryPatch, SsmTunnelInput } from '@shared/domain'
import type { TelescopeFilter, TelescopeEntry } from '@shared/telescope'
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

/** Database/schema names for autocomplete. `enabled` lets callers skip the fetch
 *  where it isn't useful (e.g. Mongo tabs, which complete databases their own way). */
export function useDatabases(connectionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['databases', connectionId],
    queryFn: () => window.api.schema.databases(connectionId!).then(unwrap),
    enabled: enabled && connectionId != null,
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

// ── Schema: diagram (all columns + relationships, fetched on demand) ──────────

export function useAllColumns(connectionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['allColumns', connectionId],
    queryFn: () => window.api.schema.allColumns(connectionId!).then(unwrap),
    enabled: enabled && connectionId != null,
    retry: false,
  })
}

export function useRelationships(connectionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['relationships', connectionId],
    queryFn: () => window.api.schema.relationships(connectionId!).then(unwrap),
    enabled: enabled && connectionId != null,
    retry: false,
  })
}

// ── Schema: one table's full structure (the "Table info" tab) ─────────────────

export function useTableInfo(connectionId: string | null, ref: ObjectRef) {
  return useQuery({
    queryKey: ['tableInfo', connectionId, ref.schema, ref.name],
    queryFn: () => window.api.schema.tableInfo(connectionId!, ref).then(unwrap),
    enabled: connectionId != null,
    retry: false,
  })
}

// ── SSM tunnels ───────────────────────────────────────────────────────────────

export function useSsmTunnels() {
  return useQuery({ queryKey: ['ssm'], queryFn: () => window.api.ssm.list().then(unwrap), retry: false })
}

export function useSaveSsmTunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SsmTunnelInput }) =>
      (id ? window.api.ssm.update(id, input) : window.api.ssm.create(input)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ssm'] }),
  })
}

export function useDeleteSsmTunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => window.api.ssm.delete(id).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ssm'] }),
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
      sshSecrets,
    }: {
      id?: string
      input: ConnectionInput
      password: string | undefined | null
      sshSecrets?: Record<string, string>
    }) => {
      if (id) {
        // Update: undefined password means "keep existing"
        return window.api.connections
          .update(id, input, password === '' ? undefined : password, sshSecrets)
          .then(unwrap)
      } else {
        // Create: null means no password
        return window.api.connections
          .create(input, password ?? null, sshSecrets)
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

/** Duplicate a connection (config + password + SSH secrets, copied in main) as a new
 *  "… (copy)"; returns the new connection so the caller can open it for editing. */
export function useDuplicateConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => window.api.connections.duplicate(id).then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['connections'] }),
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: ({
      input,
      password,
      id,
      sshSecrets,
    }: {
      input: ConnectionInput
      password: string | null
      id?: string
      sshSecrets?: Record<string, string>
    }) => window.api.connections.test(input, password, id, sshSecrets).then(unwrap),
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

// ── LLM assistant ──────────────────────────────────────────────────────────────

export function useLlmModels() {
  return useQuery({ queryKey: ['llm', 'models'], queryFn: () => window.api.llm.listModels().then(unwrap), retry: false })
}

export function useLlmConversations(connectionId: string | null) {
  return useQuery({
    queryKey: ['llm', 'conversations', connectionId],
    queryFn: () => window.api.llm.listConversations(connectionId!).then(unwrap),
    enabled: connectionId != null,
    retry: false,
  })
}

export function useLlmMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['llm', 'messages', conversationId],
    queryFn: () => window.api.llm.listMessages(conversationId!).then(unwrap),
    enabled: conversationId != null,
    retry: false,
  })
}

// ── Telescope inspector ────────────────────────────────────────────────────────

/** The list filters that identify a distinct entry query (drive the query key + cursor paging). */
export type TelescopeListFilter = Pick<TelescopeFilter, 'type' | 'tag' | 'search'>

/** Cursor-paginated entries for the current type/tag/search filter (keyset on `sequence`). */
export function useTelescopeEntries(connectionId: string | null, filter: TelescopeListFilter) {
  return useInfiniteQuery({
    queryKey: ['telescope', 'entries', connectionId, filter.type, filter.tag ?? null, filter.search ?? null],
    queryFn: ({ pageParam }) =>
      window.api.telescope
        .entries({ connectionId: connectionId!, type: filter.type, tag: filter.tag, search: filter.search, beforeSequence: pageParam })
        .then(unwrap),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    enabled: connectionId != null,
    retry: false,
  })
}

/** One entry's full detail (lazy, cached 5 min). */
export function useTelescopeEntry(connectionId: string | null, uuid: string | null) {
  return useQuery({
    queryKey: ['telescope', 'entry', connectionId, uuid],
    queryFn: () => window.api.telescope.entry(connectionId!, uuid!).then(unwrap),
    enabled: connectionId != null && uuid != null,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/** Sibling entries in an entry's batch (the "Related" tab). */
export function useTelescopeRelated(connectionId: string | null, batchId: string | null, excludeUuid?: string) {
  return useQuery({
    queryKey: ['telescope', 'related', connectionId, batchId, excludeUuid ?? null],
    queryFn: () => window.api.telescope.related(connectionId!, batchId!, excludeUuid).then(unwrap),
    enabled: connectionId != null && !!batchId,
    retry: false,
  })
}

/** Distinct tags for the tag filter. */
export function useTelescopeTags(connectionId: string | null) {
  return useQuery({
    queryKey: ['telescope', 'tags', connectionId],
    queryFn: () => window.api.telescope.tags(connectionId!).then(unwrap),
    enabled: connectionId != null,
    retry: false,
  })
}

/** Subscribe to live new-entry pushes for a connection. Starts/stops the main-side tail poller with
 *  the component lifecycle and buffers new entries (deduped, newest-first, capped at 500) so a
 *  "N new entries" banner can surface them without disrupting the scroll position. */
export function useTelescopeTail(connectionId: string | null): { newEntries: TelescopeEntry[]; clear: () => void } {
  const [newEntries, setNewEntries] = useState<TelescopeEntry[]>([])
  useEffect(() => {
    if (!connectionId) return
    void window.api.telescope.startTail(connectionId)
    const off = window.api.telescope.onNewEntries((ev) => {
      if (ev.connectionId !== connectionId) return
      setNewEntries((prev) => {
        const seen = new Set(prev.map((e) => e.uuid))
        const fresh = ev.entries.filter((e) => !seen.has(e.uuid))
        return fresh.length ? [...fresh, ...prev].slice(0, 500) : prev
      })
    })
    return () => {
      off()
      void window.api.telescope.stopTail(connectionId)
      setNewEntries([])
    }
  }, [connectionId])
  const clear = useCallback(() => setNewEntries([]), [])
  return { newEntries, clear }
}
