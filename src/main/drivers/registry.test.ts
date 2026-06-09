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
})
