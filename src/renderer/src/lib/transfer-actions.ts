import type { ConnectionConfig } from '@shared/domain'
import type { ImportPreview } from '@shared/transfer'
import { useAppStore } from '../state/store'
import { unwrap } from './result'

export type TransferModalState =
  | { mode: 'export'; connections: ConnectionConfig[] }
  | { mode: 'import'; preview: ImportPreview }

/** Native file picker first (or, with `detectedId`, the connections of another tool found on
 *  this machine); the dialog only opens once there is something valid to import.
 *  Resolves null on success or cancel, or the error message on failure. */
export async function startImport(detectedId?: string): Promise<string | null> {
  try {
    const preview = unwrap(
      detectedId === undefined ? await window.api.connections.importPick() : await window.api.connections.importDetected(detectedId)
    )
    if (preview) useAppStore.getState().setTransferModal({ mode: 'import', preview })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
