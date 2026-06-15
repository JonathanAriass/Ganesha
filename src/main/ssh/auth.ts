import type { SshHop } from '../../shared/domain'

export interface ResolvedHop {
  host: string
  port: number
  username: string
  auth: 'key' | 'password'
  privateKey?: Buffer
  passphrase?: string
  password?: string
}

/** Turn a stored hop + its secret into the concrete auth material ssh2 needs.
 *  readFile is injected (fs.readFileSync in production) so this stays pure/testable. */
export function resolveHop(hop: SshHop, secret: string | null, readFile: (p: string) => Buffer): ResolvedHop {
  const base = { host: hop.host, port: hop.port, username: hop.username, auth: hop.auth }
  if (hop.auth === 'key') {
    let privateKey: Buffer
    try {
      privateKey = readFile(hop.keyPath)
    } catch {
      throw new Error(`SSH tunnel: key file not found: ${hop.keyPath}`)
    }
    return secret ? { ...base, privateKey, passphrase: secret } : { ...base, privateKey }
  }
  if (!secret) throw new Error(`SSH tunnel: password required for hop ${hop.host}`)
  return { ...base, password: secret }
}
