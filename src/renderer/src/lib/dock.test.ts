import { describe, it, expect } from 'vitest'
import { toggleDock } from './dock'

describe('toggleDock', () => {
  it('opens a panel when the dock is closed', () => {
    expect(toggleDock(null, 'assistant')).toBe('assistant')
  })
  it('closes when the open panel is toggled again', () => {
    expect(toggleDock('assistant', 'assistant')).toBe(null)
  })
  it('switches, does not close, when the other panel is toggled', () => {
    expect(toggleDock('assistant', 'tunnels')).toBe('tunnels')
  })
})
