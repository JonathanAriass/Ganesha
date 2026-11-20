/** Extension of a connections export file (JSON inside). */
export const TRANSFER_EXTENSION = 'ganesha-connections'

/** Shortest passphrase accepted when an export includes secrets. */
export const MIN_PASSPHRASE_LENGTH = 8

/** Which tool wrote an import file. */
export const IMPORT_SOURCES = ['ganesha', 'compass', 'dbeaver'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

/** An entry of an import file that will not be imported, and why. */
export interface ImportSkip { name: string; reason: string }

/** What the renderer learns about a picked import file before committing to it.
 *  Never carries secrets — only whether the file has an encrypted block. */
export interface ImportPreview {
  fileName: string
  connections: number
  groups: number
  /** True when the file carries passphrase-encrypted passwords / SSH secrets. */
  hasSecrets: boolean
  source: ImportSource
  /** Connections whose passwords / SSH secrets can be imported without a passphrase. */
  openSecrets: number
  /** True when passwords can be brought by asking the macOS keychain for another app's key
   *  (the system asks the user for permission at that point). */
  keychainSecrets: boolean
  /** Entries that will be left out (unsupported engine, no address…). */
  skipped: ImportSkip[]
  /** Notices to show before importing (e.g. credentials that could not be read). */
  notes: string[]
}

/** Connections found in another tool installed on this machine, ready to import. */
export interface DetectedImport {
  /** Opaque: handed back to connections.importDetected. Never a path. */
  id: string
  source: ImportSource
  /** "DBeaver", "DBeaver — <project>", "MongoDB Compass". */
  label: string
  connections: number
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
