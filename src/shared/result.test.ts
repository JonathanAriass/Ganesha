import { describe, it, expect } from 'vitest'
import { ok, err } from './result'

describe('Result envelope', () => {
  it('ok() wraps data with ok: true', () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 })
  })

  it('err() wraps a message with ok: false', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' })
  })
})
