import { describe, it, expect } from 'vitest'
import { resolveHop } from './auth'
import type { SshHop } from '../../shared/domain'

const keyHop: SshHop = { id: 'h1', host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', keyPath: '/k.pem' }
const pwHop: SshHop = { id: 'h2', host: 'target', port: 2222, username: 'root', auth: 'password', keyPath: '' }

describe('resolveHop', () => {
  it('reads the key file and attaches passphrase for key auth', () => {
    const r = resolveHop(keyHop, 'phrase', () => Buffer.from('KEYDATA'))
    expect(r).toEqual({ host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', privateKey: Buffer.from('KEYDATA'), passphrase: 'phrase' })
  })
  it('omits passphrase when none is stored (unencrypted key)', () => {
    const r = resolveHop(keyHop, null, () => Buffer.from('KEYDATA'))
    expect(r.passphrase).toBeUndefined()
    expect(r.privateKey).toEqual(Buffer.from('KEYDATA'))
  })
  it('throws a prefixed error when the key file is unreadable', () => {
    expect(() => resolveHop(keyHop, null, () => { throw new Error('ENOENT') }))
      .toThrow(/SSH tunnel: key file not found: \/k\.pem/)
  })
  it('uses the stored password for password auth, never reads a file', () => {
    let read = false
    const r = resolveHop(pwHop, 'secretpw', () => { read = true; return Buffer.from('') })
    expect(read).toBe(false)
    expect(r).toEqual({ host: 'target', port: 2222, username: 'root', auth: 'password', password: 'secretpw' })
  })
  it('throws when password auth has no password', () => {
    expect(() => resolveHop(pwHop, null, () => Buffer.from('')))
      .toThrow(/SSH tunnel: password required for hop target/)
  })
})
