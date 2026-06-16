import { describe, it, expect } from 'vitest'
import { DriverManager } from './registry'
import type { DatabaseDriver } from './types'

const fakePg = { type: 'postgres' } as unknown as DatabaseDriver

describe('DriverManager', () => {
  it('registers and retrieves a driver by type', () => {
    const m = new DriverManager()
    m.register(fakePg)
    expect(m.has('postgres')).toBe(true)
    expect(m.get('postgres')).toBe(fakePg)
  })
  it('throws a clear error for an unregistered type', () => {
    const m = new DriverManager()
    expect(m.has('mysql')).toBe(false)
    expect(() => m.get('mysql')).toThrow(/no driver/i)
  })

  it('disconnectAll disconnects the id on every driver, swallowing per-driver errors', async () => {
    const calls: string[] = []
    const pg = { type: 'postgres', disconnect: async (id: string) => { calls.push(`pg:${id}`) } } as unknown as DatabaseDriver
    const mongo = { type: 'mongodb', disconnect: async () => { throw new Error('already closed') } } as unknown as DatabaseDriver
    const m = new DriverManager()
    m.register(pg)
    m.register(mongo)
    await expect(m.disconnectAll('c1')).resolves.toBeUndefined() // mongo's throw is swallowed
    expect(calls).toEqual(['pg:c1'])
  })
})
