import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConnectionInput } from '@shared/domain'
import type { ObjectRef } from '@shared/schema'
import { unwrap } from './result'

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
    onSuccess: () => {
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
    }: {
      input: ConnectionInput
      password: string | null
    }) => window.api.connections.test(input, password).then(unwrap),
  })
}
