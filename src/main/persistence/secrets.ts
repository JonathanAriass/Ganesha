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

export function makeSecretStore(db: DB, enc: Encryptor) {
  return {
    setPassword(connectionId: string, password: string): void {
      db.prepare(
        `INSERT INTO secrets (connection_id, ciphertext) VALUES (?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET ciphertext = excluded.ciphertext`
      ).run(connectionId, enc.encrypt(password))
    },
    getPassword(connectionId: string): string | null {
      const row = db.prepare('SELECT ciphertext FROM secrets WHERE connection_id = ?')
        .get(connectionId) as { ciphertext: Buffer } | undefined
      return row ? enc.decrypt(row.ciphertext) : null
    },
    deletePassword(connectionId: string): void {
      db.prepare('DELETE FROM secrets WHERE connection_id = ?').run(connectionId)
    }
  }
}
