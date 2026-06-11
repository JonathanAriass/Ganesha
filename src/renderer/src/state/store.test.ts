import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('overlay state invariants', () => {
  beforeEach(() => {
    useAppStore.setState({
      settingsOpen: false, paletteOpen: false, connectionModal: null, saveQueryModal: null
    })
  })

  it('openSettings closes the palette', () => {
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

  it('openSaveQueryModal closes the palette', () => {
    useAppStore.getState().setPaletteOpen(true)
    useAppStore.getState().openSaveQueryModal({ mode: 'create', connectionId: 'c1', query: 'q' })
    const s = useAppStore.getState()
    expect(s.saveQueryModal).toEqual({ mode: 'create', connectionId: 'c1', query: 'q' })
    expect(s.paletteOpen).toBe(false)
  })

  it('closeSaveQueryModal clears only the save modal', () => {
    useAppStore.getState().openSaveQueryModal({ mode: 'rename', id: 'q1', name: 'n' })
    useAppStore.getState().closeSaveQueryModal()
    expect(useAppStore.getState().saveQueryModal).toBeNull()
  })
})

describe('openOrLoadQuery', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, _queryCounter: 0 })
  })

  it('loads into the active tab when it belongs to the connection', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'old' })
    const tabId = useAppStore.getState().activeTabId!
    const epoch = useAppStore.getState().tabs[0].epoch
    useAppStore.getState().openOrLoadQuery({ connectionId: 'c1', title: 'Saved', text: 'new' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].text).toBe('new')
    expect(s.tabs[0].epoch).toBe(epoch + 1) // bumped → editor remounts with the new text
    expect(s.activeTabId).toBe(tabId)
  })

  it('opens a new tab when the active tab is on another connection', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'old' })
    useAppStore.getState().openOrLoadQuery({ connectionId: 'c2', title: 'Saved', text: 'new' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs[1]).toMatchObject({ connectionId: 'c2', title: 'Saved', text: 'new' })
    expect(s.activeTabId).toBe(s.tabs[1].id)
  })

  it('opens a new tab when there are no tabs at all', () => {
    useAppStore.getState().openOrLoadQuery({ connectionId: 'c1', title: 'Saved', text: 'q' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]).toMatchObject({ connectionId: 'c1', title: 'Saved', text: 'q' })
  })
})
