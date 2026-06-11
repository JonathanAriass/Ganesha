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

describe('script run lifecycle', () => {
  const result = {
    columns: [{ name: 'a', dataType: null }],
    rows: [[1]],
    rowCount: 1,
    durationMs: 5,
    truncated: false,
    documents: null
  }

  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, _queryCounter: 0 })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'select 1; select 2' })
  })

  const tab = () => useAppStore.getState().tabs[0]

  it('startScript resets result/error and arms the script', () => {
    useAppStore.getState().finishRun(tab().id, { error: 'old error' })
    useAppStore.getState().startScript(tab().id, 2, 'run-1')
    expect(tab()).toMatchObject({
      running: true,
      error: null,
      result: null,
      queryId: null,
      scriptRun: { runId: 'run-1', total: 2, entries: [], stopRequested: false }
    })
  })

  it('requestScriptStop flags the script; the next startScript re-arms clean', () => {
    useAppStore.getState().startScript(tab().id, 2, 'run-1')
    useAppStore.getState().requestScriptStop(tab().id)
    expect(tab().scriptRun?.stopRequested).toBe(true)
    // Cancel → immediate re-run: the new script must not inherit the stop.
    useAppStore.getState().startScript(tab().id, 3, 'run-2')
    expect(tab().scriptRun?.stopRequested).toBe(false)
  })

  it('requestScriptStop without an armed script is a no-op', () => {
    useAppStore.getState().requestScriptStop(tab().id)
    expect(tab().scriptRun).toBeNull()
  })

  it('scriptStatementStart points queryId at the in-flight statement (Cancel target)', () => {
    useAppStore.getState().startScript(tab().id, 2, 'run-1')
    useAppStore.getState().scriptStatementStart(tab().id, 'q-1')
    expect(tab().queryId).toBe('q-1')
    useAppStore.getState().scriptStatementStart(tab().id, 'q-2')
    expect(tab().queryId).toBe('q-2')
  })

  it('scriptStatementDone appends entries in order; finishScript keeps them', () => {
    useAppStore.getState().startScript(tab().id, 2, 'run-1')
    useAppStore.getState().scriptStatementDone(tab().id, {
      text: 'select 1;', result, error: null, skipped: false
    })
    useAppStore.getState().scriptStatementDone(tab().id, {
      text: 'select 2', result: null, error: 'boom', skipped: false
    })
    useAppStore.getState().finishScript(tab().id)
    const t = tab()
    expect(t.running).toBe(false)
    expect(t.queryId).toBeNull()
    expect(t.scriptRun?.entries.map((e) => e.text)).toEqual(['select 1;', 'select 2'])
    expect(t.scriptRun?.entries[1].error).toBe('boom')
  })

  it('a later single run supersedes the script results', () => {
    useAppStore.getState().startScript(tab().id, 2, 'run-1')
    useAppStore.getState().scriptStatementDone(tab().id, {
      text: 'select 1;', result, error: null, skipped: false
    })
    useAppStore.getState().finishScript(tab().id)
    useAppStore.getState().startRun(tab().id, 'q-9')
    expect(tab().scriptRun).toBeNull() // panel must show the spinner, not stale sections
    useAppStore.getState().finishRun(tab().id, { result })
    const t = tab()
    expect(t.scriptRun).toBeNull()
    expect(t.result).toEqual(result)
  })

  it('scriptStatementDone on a tab without an armed script is a no-op', () => {
    useAppStore.getState().scriptStatementDone(tab().id, {
      text: 'select 1;', result: null, error: null, skipped: true
    })
    expect(tab().scriptRun).toBeNull()
  })
})
