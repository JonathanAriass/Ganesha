import type { DB } from './db'

/** Abstraction over Electron safeStorage so the store is unit-testable. */
export interface Encryptor {
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}

/** Production encryptor backed by Electron's OS-keyed safeStorage. */
export function safeStorageEncryptor(): Encryptor {
  // Imported lazily so this file can be imported in tests without Electron.
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext)
  }
}

/**
 * Password to use for a connection test. A typed password (non-null) wins;
 * otherwise fall back to the stored secret when testing a SAVED connection
 * (edit mode sends its id) — blank-on-edit means "keep current", so Test must
 * exercise the same credentials connect would use. Unsaved connections
 * (no id) test with no password.
 */
export function resolveTestPassword(
  password: string | null,
  id: string | undefined,
  secrets: { getPassword(connectionId: string): string | null }
): string | null {
  return password ?? (id ? secrets.getPassword(id) : null)
}

export function makeSecretStore(db: DB, enc: Encryptor) {
  const setSecret = (connectionId: string, key: string, value: string): void => {
    db.prepare(
      `INSERT INTO secrets (connection_id, secret_key, ciphertext) VALUES (?, ?, ?)
       ON CONFLICT(connection_id, secret_key) DO UPDATE SET ciphertext = excluded.ciphertext`
    ).run(connectionId, key, enc.encrypt(value))
  }
  const getSecret = (connectionId: string, key: string): string | null => {
    const row = db.prepare('SELECT ciphertext FROM secrets WHERE connection_id = ? AND secret_key = ?')
      .get(connectionId, key) as { ciphertext: Buffer } | undefined
    return row ? enc.decrypt(row.ciphertext) : null
  }
  const deleteSecret = (connectionId: string, key: string): void => {
    db.prepare('DELETE FROM secrets WHERE connection_id = ? AND secret_key = ?').run(connectionId, key)
  }
  const deleteAllSecrets = (connectionId: string): void => {
    db.prepare('DELETE FROM secrets WHERE connection_id = ?').run(connectionId)
  }
  return {
    setSecret,
    getSecret,
    deleteSecret,
    deleteAllSecrets,
    // The DB password is just the 'db'-keyed secret; keep the old names for callers.
    setPassword: (connectionId: string, password: string) => setSecret(connectionId, 'db', password),
    getPassword: (connectionId: string) => getSecret(connectionId, 'db'),
    deletePassword: (connectionId: string) => deleteSecret(connectionId, 'db')
  }
}
