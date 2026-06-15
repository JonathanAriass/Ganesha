import { describe, it, expect } from 'vitest'
import { emptyHop, normalizeSshConfig, validateSshConfig } from './ssh-config'
import type { SshConfig } from '@shared/domain'

const hop = (over: Partial<ReturnType<typeof emptyHop>> = {}) => ({ ...emptyHop('h1'), ...over })

describe('emptyHop', () => {
  it('defaults port 22, key auth, empty strings', () => {
    expect(emptyHop('h1')).toEqual({ id: 'h1', host: '', port: 22, username: '', auth: 'key', keyPath: '' })
  })
})

describe('normalizeSshConfig', () => {
  it('passes null through', () => {
    expect(normalizeSshConfig(null)).toBeNull()
  })
  it('trims host/username/keyPath and coerces a blank port to 22', () => {
    const cfg: SshConfig = { enabled: true, hops: [hop({ host: ' bastion ', username: ' ec2-user ', keyPath: ' /k.pem ', port: 0 })] }
    expect(normalizeSshConfig(cfg)).toEqual({
      enabled: true,
      hops: [{ id: 'h1', host: 'bastion', port: 22, username: 'ec2-user', auth: 'key', keyPath: '/k.pem' }]
    })
  })
})

describe('validateSshConfig', () => {
  it('null and disabled are valid', () => {
    expect(validateSshConfig(null)).toBeNull()
    expect(validateSshConfig({ enabled: false, hops: [] })).toBeNull()
  })
  it('enabled requires at least one hop', () => {
    expect(validateSshConfig({ enabled: true, hops: [] })).toMatch(/at least one hop/i)
  })
  it('requires host, username, valid port per hop', () => {
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: '' })] })).toMatch(/host/i)
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: '' })] })).toMatch(/username/i)
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: 'u', port: 70000 })] })).toMatch(/port/i)
  })
  it('key auth requires a key path', () => {
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: 'u', auth: 'key', keyPath: '' })] })).toMatch(/key file/i)
  })
  it('a fully specified key hop is valid', () => {
    expect(validateSshConfig({ enabled: true, hops: [hop({ host: 'b', username: 'u', keyPath: '/k.pem' })] })).toBeNull()
  })
})
