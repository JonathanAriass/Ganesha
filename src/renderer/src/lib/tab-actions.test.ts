// src/renderer/src/lib/tab-actions.test.ts
import { describe, it, expect, vi } from 'vitest'
import { setTabActions, clearTabActions, getTabActions } from './tab-actions'

const mk = () => ({ run: vi.fn(), runAll: vi.fn(), refresh: vi.fn() })

describe('tab-actions registry', () => {
  it('returns the registered actions and calls through', () => {
    const a = mk()
    setTabActions('t1', () => a)
    getTabActions('t1')?.run()
    expect(a.run).toHaveBeenCalledOnce()
    clearTabActions('t1')
  })
  it('is null for unknown or cleared tabs', () => {
    expect(getTabActions('nope')).toBeNull()
    setTabActions('t2', () => mk())
    clearTabActions('t2')
    expect(getTabActions('t2')).toBeNull()
  })
  it('always reads the latest thunk result (ref pattern)', () => {
    let current = mk()
    setTabActions('t3', () => current)
    const first = current
    current = mk()
    getTabActions('t3')?.refresh()
    expect(first.refresh).not.toHaveBeenCalled()
    expect(current.refresh).toHaveBeenCalledOnce()
    clearTabActions('t3')
  })
})
