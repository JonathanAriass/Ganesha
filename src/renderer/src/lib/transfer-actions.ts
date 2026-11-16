import type { ConnectionConfig } from '@shared/domain'
import type { ImportPreview } from '@shared/transfer'
import { useAppStore } from '../state/store'
import { unwrap } from './result'

export type TransferModalState =
  | { mode: 'export'; connections: ConnectionConfig[] }
  | { mode: 'import'; preview: ImportPreview }

/** Native file picker first; the dialog only opens once a valid file is chosen.
 *  Resolves null on success or cancel, or the error message on failure. */
export async function startImport(): Promise<string | null> {
  try {
    const preview = unwrap(await window.api.connections.importPick())
    if (preview) useAppStore.getState().setTransferModal({ mode: 'import', preview })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
