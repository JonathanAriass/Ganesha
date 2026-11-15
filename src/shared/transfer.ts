/** Extension of a connections export file (JSON inside). */
export const TRANSFER_EXTENSION = 'ganesha-connections'

/** Shortest passphrase accepted when an export includes secrets. */
export const MIN_PASSPHRASE_LENGTH = 8

/** What the renderer learns about a picked import file before committing to it.
 *  Never carries secrets — only whether the file has an encrypted block. */
export interface ImportPreview {
  fileName: string
  connections: number
  groups: number
  /** True when the file carries passphrase-encrypted passwords / SSH secrets. */
  hasSecrets: boolean
}

export interface ExportResult {
  path: string
  connections: number
  /** True when passwords / SSH secrets were written (encrypted) into the file. */
  withSecrets: boolean
}

export interface ImportResult {
  imported: number
  /** Connections already present here (same type, name, host, port, user and database). */
  skipped: number
  groupsCreated: number
  /** True when the file's secrets were decrypted and stored for the imported connections. */
  withSecrets: boolean
}
