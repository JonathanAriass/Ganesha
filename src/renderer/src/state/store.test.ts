import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SessionTab } from '@shared/domain'
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
    documents: null,
    editable: null
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

describe('renameTab', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, _queryCounter: 0 })
    useAppStore.getState().openQueryTab({ connectionId: 'c1' })
  })

  const tab = () => useAppStore.getState().tabs[0]

  it('renames with the trimmed title', () => {
    useAppStore.getState().renameTab(tab().id, '  Orders by day  ')
    expect(tab().title).toBe('Orders by day')
  })

  it('rejects empty and whitespace-only titles', () => {
    useAppStore.getState().renameTab(tab().id, '   ')
    expect(tab().title).toBe('Query 1')
  })

  it('unknown id is a no-op', () => {
    useAppStore.getState().renameTab('nope', 'X')
    expect(tab().title).toBe('Query 1')
  })

  it('a renamed title round-trips through hydrateTabs', () => {
    useAppStore.getState().renameTab(tab().id, 'mine')
    const persisted = { id: tab().id, connectionId: 'c1', title: tab().title, text: '', active: true }
    useAppStore.setState({ tabs: [], activeTabId: null })
    useAppStore.getState().hydrateTabs([persisted])
    expect(useAppStore.getState().tabs[0].title).toBe('mine')
  })
})

describe('hydrateTabs', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0 })
  })

  const session = (over: Partial<SessionTab> & { id: string }): SessionTab => ({
    connectionId: 'c1', title: 'Query 1', text: 'SELECT 1', active: false, ...over
  })

  it('restores tabs in order with clean volatile state', () => {
    useAppStore.getState().hydrateTabs([
      session({ id: 'a', title: 'Query 1', text: 'SELECT 1' }),
      session({ id: 'b', title: 'mine', text: '', active: true })
    ])
    const s = useAppStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(s.tabs[0]).toEqual({
      id: 'a', connectionId: 'c1', title: 'Query 1', text: 'SELECT 1',
      epoch: 0, runOnOpen: false, running: false, queryId: null,
      result: null, error: null, scriptRun: null, edits: {}, editError: null
    })
    expect(s.activeTabId).toBe('b')
  })

  it('never clobbers tabs the user already opened', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c9', text: 'mine' })
    const userTabId = useAppStore.getState().activeTabId
    useAppStore.getState().hydrateTabs([session({ id: 'a', active: true })])
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].text).toBe('mine')
    expect(s.activeTabId).toBe(userTabId)
  })

  it('empty session is a no-op', () => {
    useAppStore.getState().hydrateTabs([])
    expect(useAppStore.getState().tabs).toEqual([])
    expect(useAppStore.getState().activeTabId).toBeNull()
  })

  it('bumps the query counter past restored "Query N" titles', () => {
    useAppStore.getState().hydrateTabs([
      session({ id: 'a', title: 'Query 3' }),
      session({ id: 'b', title: 'custom name', active: true })
    ])
    useAppStore.getState().openQueryTab({ connectionId: 'c1' })
    expect(useAppStore.getState().tabs[2].title).toBe('Query 4')
  })

  it('falls back to the last tab when none is flagged active', () => {
    useAppStore.getState().hydrateTabs([session({ id: 'a' }), session({ id: 'b' })])
    expect(useAppStore.getState().activeTabId).toBe('b')
  })

  it('the first flagged tab wins when several claim active', () => {
    useAppStore.getState().hydrateTabs([
      session({ id: 'a' }), session({ id: 'b', active: true }), session({ id: 'c', active: true })
    ])
    expect(useAppStore.getState().activeTabId).toBe('b')
  })

  it('points the sidebar at the active tab connection when none is selected', () => {
    useAppStore.getState().hydrateTabs([
      session({ id: 'a', connectionId: 'c1' }),
      session({ id: 'b', connectionId: 'c2', active: true })
    ])
    expect(useAppStore.getState().activeConnectionId).toBe('c2')
  })

  it('keeps an existing sidebar selection', () => {
    useAppStore.setState({ activeConnectionId: 'chosen' })
    useAppStore.getState().hydrateTabs([session({ id: 'a', active: true })])
    expect(useAppStore.getState().activeConnectionId).toBe('chosen')
  })
})

describe('applyResultEdits', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, _queryCounter: 0 })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'select * from t' })
  })
  const tab = () => useAppStore.getState().tabs[0]
  const result = {
    columns: [{ name: 'id', dataType: null }, { name: 'name', dataType: null }],
    rows: [[1, 'a'], [2, 'b']],
    rowCount: 2, durationMs: 1, truncated: false, documents: null,
    editable: { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', 'name'] }
  }

  it('replaces the given cells and produces a new rows array', () => {
    useAppStore.getState().finishRun(tab().id, { result })
    const before = tab().result!.rows
    useAppStore.getState().applyResultEdits(tab().id, [{ rowIndex: 1, colIndex: 1, value: 'B' }])
    const after = tab().result!.rows
    expect(after[1][1]).toBe('B')
    expect(after[0][1]).toBe('a') // untouched row unchanged
    expect(after).not.toBe(before) // new array reference
    expect(after[0]).toBe(before[0]) // untouched row keeps its reference
  })

  it('is a no-op for a tab without a result', () => {
    expect(() => useAppStore.getState().applyResultEdits(tab().id, [{ rowIndex: 0, colIndex: 0, value: 9 }])).not.toThrow()
  })
})

describe('staged cell edits', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, _queryCounter: 0 })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'select * from t' })
  })
  // store.test.ts runs in the node env (no DOM), so stub `window` on globalThis — the
  // store's commitEdits reaches window.api.edits.apply, which resolves through it.
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })
  const tab = () => useAppStore.getState().tabs[0]
  const s = () => useAppStore.getState()
  const stubApply = (apply: ReturnType<typeof vi.fn>): void => {
    ;(globalThis as unknown as { window: { api: { edits: { apply: typeof apply } } } }).window = { api: { edits: { apply } } }
  }

  it('setCellEdit stages a value; resetCellEdit drops just that cell', () => {
    s().setCellEdit(tab().id, '0:1', 'X')
    s().setCellEdit(tab().id, '1:1', 'Y')
    expect(tab().edits).toEqual({ '0:1': 'X', '1:1': 'Y' })
    s().resetCellEdit(tab().id, '0:1')
    expect(tab().edits).toEqual({ '1:1': 'Y' }) // the other stays
  })

  it('discardEdits clears all staged edits and the error', () => {
    s().setCellEdit(tab().id, '0:1', 'X')
    useAppStore.setState({ tabs: s().tabs.map((t) => ({ ...t, editError: 'boom' })) })
    s().discardEdits(tab().id)
    expect(tab().edits).toEqual({})
    expect(tab().editError).toBeNull()
  })

  it('a new run clears staged edits', () => {
    s().setCellEdit(tab().id, '0:1', 'X')
    s().startRun(tab().id, 'q1')
    expect(tab().edits).toEqual({})
  })

  it('openCommitModal / closeCommitModal toggle the review modal for a tab', () => {
    s().openCommitModal(tab().id)
    expect(useAppStore.getState().commitModal).toEqual({ tabId: tab().id })
    s().closeCommitModal()
    expect(useAppStore.getState().commitModal).toBeNull()
  })

  it('commitEdits applies via the api, adopts new values, and clears the stage', async () => {
    const apply = vi.fn().mockResolvedValue({ ok: true, data: { updated: 1 } })
    stubApply(apply)
    s().finishRun(tab().id, {
      result: {
        columns: [{ name: 'id', dataType: null }, { name: 'name', dataType: null }],
        rows: [[1, 'a']], rowCount: 1, durationMs: 1, truncated: false, documents: null,
        editable: { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', 'name'] }
      }
    })
    s().setCellEdit(tab().id, '0:1', 'NEW')
    await s().commitEdits(tab().id)
    expect(apply).toHaveBeenCalledWith({ connectionId: 'c1', table: { schema: null, name: 't' }, rows: [{ key: { id: 1 }, set: { name: 'NEW' } }] })
    expect(tab().result!.rows[0][1]).toBe('NEW') // adopted
    expect(tab().edits).toEqual({}) // cleared
    expect(tab().editError).toBeNull()
  })

  it('commitEdits is a no-op (no api call) when nothing is staged', async () => {
    const apply = vi.fn()
    stubApply(apply)
    s().finishRun(tab().id, {
      result: {
        columns: [{ name: 'id', dataType: null }], rows: [[1]], rowCount: 1, durationMs: 1, truncated: false, documents: null,
        editable: { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id'] }
      }
    })
    await s().commitEdits(tab().id)
    expect(apply).not.toHaveBeenCalled()
  })

  it('commitEdits keeps the stage and records the error on failure', async () => {
    const apply = vi.fn().mockResolvedValue({ ok: false, error: 'read-only' })
    stubApply(apply)
    s().finishRun(tab().id, {
      result: {
        columns: [{ name: 'id', dataType: null }, { name: 'name', dataType: null }],
        rows: [[1, 'a']], rowCount: 1, durationMs: 1, truncated: false, documents: null,
        editable: { table: { schema: null, name: 't' }, keyColumns: ['id'], columnSources: ['id', 'name'] }
      }
    })
    s().setCellEdit(tab().id, '0:1', 'NEW')
    await s().commitEdits(tab().id)
    expect(tab().edits).toEqual({ '0:1': 'NEW' }) // intact for retry
    expect(tab().editError).toMatch(/read-only/)
  })
})
