import { describe, it, expect } from 'vitest'
import { portAfterEngineChange, connectionFormProblem, DEFAULT_PORTS, ENGINES } from './connection-form'

describe('portAfterEngineChange', () => {
  it('follows the new engine while the port is still the old default', () => {
    expect(portAfterEngineChange('postgres', 'mongodb', 5432)).toBe(27017)
    expect(portAfterEngineChange('mongodb', 'mysql', 27017)).toBe(3306)
  })
  it('keeps a port the user chose', () => {
    expect(portAfterEngineChange('postgres', 'mysql', 15432)).toBe(15432)
  })
  it('is a no-op between engines that share a default', () => {
    expect(portAfterEngineChange('mysql', 'mariadb', 3306)).toBe(3306)
  })
  it('has a default port for every engine offered', () => {
    for (const e of ENGINES) expect(DEFAULT_PORTS[e.type]).toBeGreaterThan(0)
  })
})

describe('connectionFormProblem', () => {
  const ok = { name: 'Local', host: 'localhost', port: 5432 }
  it('accepts a complete form', () => {
    expect(connectionFormProblem(ok)).toBeNull()
  })
  it('asks for a name first, then a host', () => {
    expect(connectionFormProblem({ ...ok, name: '  ' })).toBe('Give the connection a name')
    expect(connectionFormProblem({ ...ok, host: '' })).toBe('Enter the server host')
    expect(connectionFormProblem({ name: '', host: '', port: 0 })).toBe('Give the connection a name')
  })
  it('rejects ports outside 1–65535, fractions and an emptied field', () => {
    for (const port of [0, -1, 65536, 1.5, NaN]) {
      expect(connectionFormProblem({ ...ok, port })).toBe('Port must be between 1 and 65535')
    }
    expect(connectionFormProblem({ ...ok, port: 65535 })).toBeNull()
  })
})
