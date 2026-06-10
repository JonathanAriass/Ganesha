import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('overlay state invariants', () => {
  beforeEach(() => {
    useAppStore.setState({ settingsOpen: false, paletteOpen: false, connectionModal: null })
  })

  it('openSettings closes the palette — at most one overlay at a time', () => {
    useAppStore.getState().setPaletteOpen(true)
    useAppStore.getState().openSettings()
    const s = useAppStore.getState()
    expect(s.settingsOpen).toBe(true)
    expect(s.paletteOpen).toBe(false)
  })

  it('setPaletteOpen toggles the palette flag', () => {
    useAppStore.getState().setPaletteOpen(true)
    expect(useAppStore.getState().paletteOpen).toBe(true)
    useAppStore.getState().setPaletteOpen(false)
    expect(useAppStore.getState().paletteOpen).toBe(false)
  })

  it('closeSettings clears only the settings flag', () => {
    useAppStore.getState().openModal({ mode: 'create' })
    useAppStore.getState().openSettings()
    useAppStore.getState().closeSettings()
    const s = useAppStore.getState()
    expect(s.settingsOpen).toBe(false)
    expect(s.connectionModal).toEqual({ mode: 'create' })
  })
})
