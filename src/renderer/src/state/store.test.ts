import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SessionTab } from '@shared/domain'
import { filterKey } from '@shared/query'
import { useAppStore } from './store'
import { editKey } from '../lib/doc-path'

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
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
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

describe('openTableQuery', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0, activeConnectionId: null, lastActiveByConnection: {},
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
  })

  it('opens a new auto-run tab when that table is not open yet', () => {
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: '105', text: 'select * from 105' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]).toMatchObject({ connectionId: 'c1', title: '105', text: 'select * from 105', runOnOpen: true })
    expect(s.activeTabId).toBe(s.tabs[0].id)
  })

  it('opening a different table keeps the previous one open (does not replace it)', () => {
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: '105', text: 'q105' })
    const id105 = useAppStore.getState().activeTabId!
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: '106', text: 'q106' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(2) // 105 stays open
    expect(s.tabs.find((t) => t.id === id105)).toMatchObject({ title: '105', text: 'q105' })
    const t106 = s.tabs.find((t) => t.title === '106')!
    expect(t106).toMatchObject({ text: 'q106', runOnOpen: true })
    expect(s.activeTabId).toBe(t106.id)
  })

  it('re-opening an already-open table focuses its tab (no duplicate)', () => {
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: '105', text: 'q105' })
    const id105 = useAppStore.getState().activeTabId!
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: '106', text: 'q106' }) // 106 now active
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: '105', text: 'q105' }) // re-open 105
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(2) // no duplicate 105
    expect(s.activeTabId).toBe(id105) // focused the existing 105 tab
  })

  it('matches per connection — the same table name on another connection is its own tab', () => {
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: 'users', text: 'q' })
    useAppStore.getState().openTableQuery({ connectionId: 'c2', title: 'users', text: 'q' })
    expect(useAppStore.getState().tabs).toHaveLength(2)
  })

  it('does not match a diagram tab — opens a query tab', () => {
    useAppStore.getState().openDiagramTab('c1')
    useAppStore.getState().openTableQuery({ connectionId: 'c1', title: 'users', text: 'q' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs.find((t) => t.kind !== 'diagram')).toMatchObject({ title: 'users', runOnOpen: true })
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
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
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
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
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
    const persisted = { id: tab().id, connectionId: 'c1', title: tab().title, text: '', pane: 'left' as const, active: true }
    useAppStore.setState({ tabs: [], activeTabId: null })
    useAppStore.getState().hydrateTabs([persisted])
    expect(useAppStore.getState().tabs[0].title).toBe('mine')
  })
})

describe('hydrateTabs', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
  })

  const session = (over: Partial<SessionTab> & { id: string }): SessionTab => ({
    connectionId: 'c1', title: 'Query 1', text: 'SELECT 1', pane: 'left', active: false, ...over
  })

  it('restores tabs in order with clean volatile state', () => {
    useAppStore.getState().hydrateTabs([
      session({ id: 'a', title: 'Query 1', text: 'SELECT 1' }),
      session({ id: 'b', title: 'mine', text: '', active: true })
    ])
    const s = useAppStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(s.tabs[0]).toEqual({
      id: 'a', connectionId: 'c1', title: 'Query 1', text: 'SELECT 1', pane: 'left',
      epoch: 0, runOnOpen: false, running: false, queryId: null,
      result: null, resultQueryId: null, hasMore: false, loadingMore: false,
      filter: '', filterMode: { caseSensitive: false, wholeWord: false, regex: false }, columnFilters: {}, filterView: null,
      error: null, scriptRun: null, edits: {}, editError: null
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

  it('restores the flagged active tab', () => {
    // toSessionTabs now always flags exactly one active tab per pane; the per-pane hydrate
    // honours that flag. The no-flag fallback (the pane's FIRST tab) is covered by the next test.
    useAppStore.getState().hydrateTabs([session({ id: 'a' }), session({ id: 'b', active: true })])
    expect(useAppStore.getState().activeTabId).toBe('b')
  })

  it("falls back to the pane's first tab when none is flagged active", () => {
    useAppStore.getState().hydrateTabs([session({ id: 'a' }), session({ id: 'b' })])
    expect(useAppStore.getState().activeTabId).toBe('a') // first tab, since no session tab is flagged
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

  it("sets the active connection to the restored active tab's connection (the active group)", () => {
    // Grouped tabs unify the active connection with the active tab's group, so a stale
    // pre-restore sidebar pick is replaced — the restored active tab defines the active group.
    useAppStore.setState({ activeConnectionId: 'chosen' })
    useAppStore.getState().hydrateTabs([session({ id: 'a', connectionId: 'c1', active: true })])
    expect(useAppStore.getState().activeConnectionId).toBe('c1')
  })
})

describe('split views — hydrate', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('restores per-pane tabs, each pane’s active, and focuses left', () => {
    useAppStore.getState().hydrateTabs([
      { id: 'a', connectionId: 'c1', title: 'A', text: 'a', pane: 'left', active: true },
      { id: 'b', connectionId: 'c2', title: 'B', text: 'b', pane: 'right', active: true },
    ])
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === 'a')!.pane).toBe('left')
    expect(s.tabs.find((t) => t.id === 'b')!.pane).toBe('right')
    expect(s.activeTabByPane).toEqual({ left: 'a', right: 'b' })
    expect(s.activeConnByPane).toEqual({ left: 'c1', right: 'c2' })
    expect(s.focusedPane).toBe('left')
    expect(s.activeTabId).toBe('a') // mirror = focused (left)
  })

  it('treats legacy tabs (no pane) as a single left pane', () => {
    useAppStore.getState().hydrateTabs([
      { id: 'a', connectionId: 'c1', title: 'A', text: 'a', active: true } as never,
    ])
    const s = useAppStore.getState()
    expect(s.tabs[0].pane).toBe('left')
    expect(s.tabs.some((t) => t.pane === 'right')).toBe(false)
  })
})

describe('applyResultEdits', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
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
    useAppStore.getState().applyResultEdits(tab().id, [{ rowIndex: 1, path: 'name', value: 'B' }])
    const after = tab().result!.rows
    expect(after[1][1]).toBe('B')
    expect(after[0][1]).toBe('a') // untouched row unchanged
    expect(after).not.toBe(before) // new array reference
    expect(after[0]).toBe(before[0]) // untouched row keeps its reference
  })

  it('is a no-op for a tab without a result', () => {
    expect(() => useAppStore.getState().applyResultEdits(tab().id, [{ rowIndex: 0, path: 'id', value: 9 }])).not.toThrow()
  })

  it('patches the parallel documents array (Mongo JSON view) by column name', () => {
    const mongoResult = {
      columns: [{ name: '_id', dataType: null }, { name: 'name', dataType: null }],
      rows: [[1, 'a'], [2, 'b']],
      rowCount: 2, durationMs: 1, truncated: false,
      documents: [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }],
      editable: { table: { schema: 'db', name: 'c' }, keyColumns: ['_id'], columnSources: ['_id', 'name'] }
    }
    useAppStore.getState().finishRun(tab().id, { result: mongoResult })
    const beforeDocs = tab().result!.documents!
    useAppStore.getState().applyResultEdits(tab().id, [{ rowIndex: 1, path: 'name', value: 'B' }])
    const docs = tab().result!.documents!
    expect(docs[1]).toEqual({ _id: 2, name: 'B' }) // patched by path
    expect(docs[0]).toEqual({ _id: 1, name: 'a' }) // untouched
    expect(docs).not.toBe(beforeDocs) // new array reference
    expect(docs[0]).toBe(beforeDocs[0]) // untouched doc keeps its reference
    expect(tab().result!.rows[1][1]).toBe('B') // and the table cell too
  })

  it('patches a nested document path (tree edit) and refreshes the ancestor table cell', () => {
    const mongoResult = {
      columns: [{ name: '_id', dataType: null }, { name: 'addr', dataType: null }],
      rows: [[1, { city: 'Paris', zip: 75001 }]],
      rowCount: 1, durationMs: 1, truncated: false,
      documents: [{ _id: 1, addr: { city: 'Paris', zip: 75001 } }],
      editable: { table: { schema: 'db', name: 'c' }, keyColumns: ['_id'], columnSources: ['_id', 'addr'] }
    }
    useAppStore.getState().finishRun(tab().id, { result: mongoResult })
    useAppStore.getState().applyResultEdits(tab().id, [{ rowIndex: 0, path: 'addr.city', value: 'Lyon' }])
    expect(tab().result!.documents![0]).toEqual({ _id: 1, addr: { city: 'Lyon', zip: 75001 } })
    // the table's top-level `addr` cell is rebuilt from the patched doc (table+tree sync)
    expect(tab().result!.rows[0][1]).toEqual({ city: 'Lyon', zip: 75001 })
  })
})

describe('staged cell edits', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
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
    s().setCellEdit(tab().id, editKey(0, 'name'), 'NEW')
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
    s().setCellEdit(tab().id, editKey(0, 'name'), 'NEW')
    await s().commitEdits(tab().id)
    expect(tab().edits).toEqual({ [editKey(0, 'name')]: 'NEW' }) // intact for retry
    expect(tab().editError).toMatch(/read-only/)
  })
})

describe('split views — opens target the focused pane', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('openQueryTab creates a left tab and mirrors active*', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'q' })
    const s = useAppStore.getState()
    expect(s.tabs[0].pane).toBe('left')
    expect(s.activeTabByPane.left).toBe(s.tabs[0].id)
    expect(s.activeTabId).toBe(s.tabs[0].id) // mirror
    expect(s.activeConnectionId).toBe('c1') // mirror
  })

  it('setActiveConnection switches only the focused pane', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'q' })
    useAppStore.setState({ focusedPane: 'right', activeConnByPane: { left: 'c1', right: null }, activeTabByPane: { left: useAppStore.getState().tabs[0].id, right: null } })
    useAppStore.getState().setActiveConnection('c2')
    const s = useAppStore.getState()
    expect(s.activeConnByPane.right).toBe('c2')
    expect(s.activeConnByPane.left).toBe('c1') // left untouched
    expect(s.activeConnectionId).toBe('c2') // mirror = focused (right)
  })
})

describe('split views — split/move/focus', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('splitActiveTab peels the active tab to the right when the pane has ≥2 tabs', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' }) // B active, left
    const bId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab()
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === bId)!.pane).toBe('right')
    expect(s.tabs.some((t) => t.pane === 'right')).toBe(true) // split visible
    expect(s.focusedPane).toBe('right')
    expect(s.activeTabByPane.right).toBe(bId)
  })

  it('splitActiveTab opens a fresh tab on the other side when the pane has one tab', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    const aId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab()
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === aId)!.pane).toBe('left') // original stays
    expect(s.tabs.filter((t) => t.pane === 'right')).toHaveLength(1) // new tab on the right
    expect(s.focusedPane).toBe('right')
    expect(s.activeConnByPane.right).toBe('c1') // same connection
  })

  it('moveTabToOtherPane moves a tab and focuses the destination', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' })
    const aId = useAppStore.getState().tabs[0].id
    useAppStore.getState().moveTabToOtherPane(aId)
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === aId)!.pane).toBe('right')
    expect(s.focusedPane).toBe('right')
    expect(s.activeTabByPane.right).toBe(aId)
    expect(s.activeTabByPane.left).toBe(s.tabs.find((t) => t.title === 'B')!.id) // left reselected
  })

  it('focusPane is a no-op for an empty pane and switches focus + mirror otherwise', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().focusPane('right') // right empty → no-op
    expect(useAppStore.getState().focusedPane).toBe('left')
    useAppStore.getState().splitActiveTab() // now right has the fresh tab, focus right
    useAppStore.getState().focusPane('left')
    const s = useAppStore.getState()
    expect(s.focusedPane).toBe('left')
    expect(s.activeTabId).toBe(s.activeTabByPane.left) // mirror follows focus
  })

  it('split keeps activeConnByPane[src] consistent when the survivor is a different connection', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' }) // left
    useAppStore.getState().openQueryTab({ connectionId: 'c2', title: 'B', text: 'b' }) // left, B(c2) active
    useAppStore.getState().splitActiveTab() // B(c2) peeled right; left survivor A(c1)
    const s = useAppStore.getState()
    expect(s.activeTabByPane.left).toBe(s.tabs.find((t) => t.title === 'A')!.id)
    expect(s.activeConnByPane.left).toBe('c1') // NOT stale c2
    expect(s.activeConnByPane.right).toBe('c2')
  })

  it('move keeps activeConnByPane[src] consistent when moving the active tab away', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' }) // left
    useAppStore.getState().openQueryTab({ connectionId: 'c2', title: 'B', text: 'b' }) // left, B(c2) active
    const bId = useAppStore.getState().activeTabId!
    useAppStore.getState().moveTabToOtherPane(bId) // B(c2)→right; left survivor A(c1); still split
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === bId)!.pane).toBe('right')
    expect(s.activeTabByPane.left).toBe(s.tabs.find((t) => t.title === 'A')!.id)
    expect(s.activeConnByPane.left).toBe('c1') // not stale c2
  })
})

describe('split views — close', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {}, commitModal: null,
    })
  })

  function splitTwo() {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' })
    const bId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab() // B → right, focus right
    return { aId: useAppStore.getState().tabs.find((t) => t.title === 'A')!.id, bId }
  }

  it('closing the last right tab collapses to one left pane', () => {
    const { aId, bId } = splitTwo()
    useAppStore.getState().closeTab(bId)
    const s = useAppStore.getState()
    expect(s.tabs.map((t) => t.pane)).toEqual(['left'])
    expect(s.tabs[0].id).toBe(aId)
    expect(s.focusedPane).toBe('left')
    expect(s.activeTabByPane.right).toBeNull()
    expect(s.activeTabId).toBe(aId) // mirror
  })

  it('closing a left tab while right has tabs keeps the split and reselects left', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'C', text: 'c' }) // A,B,C left, C active
    const cId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab() // C → right
    const aId = useAppStore.getState().tabs.find((t) => t.title === 'A')!.id
    useAppStore.getState().focusPane('left')
    useAppStore.getState().closeTab(aId)
    const s = useAppStore.getState()
    expect(s.tabs.some((t) => t.id === cId && t.pane === 'right')).toBe(true) // still split
    expect(s.activeTabByPane.left).toBe(s.tabs.find((t) => t.title === 'B')!.id)
  })

  it('closing the last left tab re-homes the right tabs to left', () => {
    const { bId } = splitTwo() // A left, B right
    useAppStore.getState().focusPane('left')
    const aId = useAppStore.getState().tabs.find((t) => t.title === 'A')!.id
    useAppStore.getState().closeTab(aId)
    const s = useAppStore.getState()
    expect(s.tabs.every((t) => t.pane === 'left')).toBe(true)
    expect(s.tabs.map((t) => t.id)).toEqual([bId])
    expect(s.focusedPane).toBe('left')
  })
})

describe('split views — reorderTab (drag-and-drop)', () => {
  const mk = (id: string, connectionId: string, pane: 'left' | 'right') => ({
    id, connectionId, title: id, pane, text: '', epoch: 0, runOnOpen: false, running: false,
    queryId: null, result: null, resultQueryId: null, hasMore: false, loadingMore: false,
    filter: '', filterMode: { caseSensitive: false, wholeWord: false, regex: false }, columnFilters: {}, filterView: null,
    error: null, scriptRun: null, edits: {}, editError: null,
  })

  it('reorders within a pane and keeps the tab active', () => {
    useAppStore.setState({
      tabs: [mk('a', 'c1', 'left'), mk('b', 'c1', 'left'), mk('c', 'c1', 'left')],
      focusedPane: 'left', activeTabByPane: { left: 'b', right: null }, activeConnByPane: { left: 'c1', right: null },
      activeTabId: 'b', activeConnectionId: 'c1', _queryCounter: 0, lastActiveByConnection: {},
    })
    useAppStore.getState().reorderTab({ tabId: 'b', toPane: 'left', beforeId: null }) // → end of the strip
    const s = useAppStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(s.activeTabId).toBe('b') // still active (mirror)
  })

  it('moves a tab across panes, recomputing activeConnByPane from the survivor (no stale conn)', () => {
    // left: a(c1), b(c2) with b active; right: c(c1) active. Drag b(c2) into the right pane.
    useAppStore.setState({
      tabs: [mk('a', 'c1', 'left'), mk('b', 'c2', 'left'), mk('c', 'c1', 'right')],
      focusedPane: 'left', activeTabByPane: { left: 'b', right: 'c' }, activeConnByPane: { left: 'c2', right: 'c1' },
      activeTabId: 'b', activeConnectionId: 'c2', _queryCounter: 0, lastActiveByConnection: {},
    })
    useAppStore.getState().reorderTab({ tabId: 'b', toPane: 'right', beforeId: 'c' })
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === 'b')!.pane).toBe('right')
    expect(s.activeTabByPane.left).toBe('a') // survivor
    expect(s.activeConnByPane.left).toBe('c1') // a's conn — NOT stale c2
    expect(s.activeTabByPane.right).toBe('b') // moved tab focused
    expect(s.focusedPane).toBe('right')
    expect(s.activeConnectionId).toBe('c2') // b's conn (mirror = focused right)
  })

  it('a no-op drop leaves state untouched', () => {
    const tabs = [mk('a', 'c1', 'left'), mk('b', 'c1', 'left')]
    useAppStore.setState({
      tabs, focusedPane: 'left', activeTabByPane: { left: 'a', right: null }, activeConnByPane: { left: 'c1', right: null },
      activeTabId: 'a', activeConnectionId: 'c1', _queryCounter: 0, lastActiveByConnection: {},
    })
    useAppStore.getState().reorderTab({ tabId: 'b', toPane: 'left', beforeId: 'b' }) // self-drop
    expect(useAppStore.getState().tabs).toBe(tabs) // unchanged reference
  })

  it('splitTabToSide splits, focuses the dragged tab, and keeps activeConnByPane consistent', () => {
    // not split: a(c1), b(c2), c(c1) all left with b active. Drag b(c2) to the right edge.
    useAppStore.setState({
      tabs: [mk('a', 'c1', 'left'), mk('b', 'c2', 'left'), mk('c', 'c1', 'left')],
      focusedPane: 'left', activeTabByPane: { left: 'b', right: null }, activeConnByPane: { left: 'c2', right: null },
      activeTabId: 'b', activeConnectionId: 'c2', _queryCounter: 0, lastActiveByConnection: {},
    })
    useAppStore.getState().splitTabToSide({ tabId: 'b', side: 'right' })
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === 'b')!.pane).toBe('right')
    expect(s.tabs.filter((t) => t.pane === 'left').map((t) => t.id)).toEqual(['a', 'c']) // rest on the left
    expect(s.focusedPane).toBe('right')
    expect(s.activeTabByPane.right).toBe('b')
    expect(s.activeTabByPane.left).toBe('a') // survivor
    expect(s.activeConnByPane.left).toBe('c1') // a's conn — NOT stale c2
    expect(s.activeConnectionId).toBe('c2') // b's conn (mirror = focused right)
  })
})

describe('results filter view (main-side search)', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
    })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'select 1' })
  })
  const tab = () => useAppStore.getState().tabs[0]
  const page = (over: Record<string, unknown> = {}) => ({
    rows: [[1]] as unknown[][], documents: null, indices: [0], total: 1, hasMore: false, invalid: false, highlight: [], ...over,
  })
  // key for a plain (default-mode) query on `text`
  const key = (text: string, over = {}) => filterKey({ text, caseSensitive: false, wholeWord: false, regex: false, columns: [], ...over })

  it('setFilter records text; clearFilterView drops the matches', () => {
    const id = tab().id
    useAppStore.getState().setFilter(id, 'ab')
    expect(tab().filter).toBe('ab')
    useAppStore.getState().applyFilterPage(id, key('ab'), page())
    expect(tab().filterView?.key).toBe(key('ab'))
    // The panel effect clears the view when nothing is active (setFilter only records the text).
    useAppStore.getState().setFilter(id, '')
    expect(tab().filter).toBe('')
    useAppStore.getState().clearFilterView(id)
    expect(tab().filterView).toBeNull()
  })

  it('setColumnFilter records/removes per-column inputs', () => {
    const id = tab().id
    useAppStore.getState().setColumnFilter(id, 1, '>30')
    expect(tab().columnFilters).toEqual({ 1: '>30' })
    useAppStore.getState().setColumnFilter(id, 2, '=active')
    expect(tab().columnFilters).toEqual({ 1: '>30', 2: '=active' })
    useAppStore.getState().setColumnFilter(id, 1, '') // blank removes it
    expect(tab().columnFilters).toEqual({ 2: '=active' })
  })

  it('applyFilterPage is dropped when the query has since changed (race guard)', () => {
    const id = tab().id
    useAppStore.getState().setFilter(id, 'abc')
    useAppStore.getState().applyFilterPage(id, key('ab'), page()) // stale response for an old query
    expect(tab().filterView).toBeNull()
    useAppStore.getState().applyFilterPage(id, key('abc'), page({ total: 3 }))
    expect(tab().filterView?.total).toBe(3)
  })

  it('a filter-mode change also invalidates a stale page (key includes the toggles)', () => {
    const id = tab().id
    useAppStore.getState().setFilter(id, 'ab')
    useAppStore.getState().setFilterMode(id, { regex: true })
    useAppStore.getState().applyFilterPage(id, key('ab'), page()) // default-mode key, but mode is now regex
    expect(tab().filterView).toBeNull()
    useAppStore.getState().applyFilterPage(id, key('ab', { regex: true }), page({ total: 2 }))
    expect(tab().filterView?.total).toBe(2)
  })

  it('appendFilterRows appends matches + indices, and drops a stale-query page', () => {
    const id = tab().id
    useAppStore.getState().setFilter(id, 'ab')
    useAppStore.getState().applyFilterPage(id, key('ab'), page({ rows: [[1]], indices: [0], total: 2, hasMore: true }))
    useAppStore.getState().appendFilterRows(id, key('ab'), page({ rows: [[2]], indices: [5], total: 2, hasMore: false }))
    expect(tab().filterView?.rows).toEqual([[1], [2]])
    expect(tab().filterView?.indices).toEqual([0, 5]) // original indexes preserved
    expect(tab().filterView?.hasMore).toBe(false)
    useAppStore.getState().appendFilterRows(id, key('xx'), page({ rows: [[9]] })) // stale query → ignored
    expect(tab().filterView?.rows).toEqual([[1], [2]])
  })
})

describe('openTelescopeTab', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('opens a telescope-kind tab and makes it active', () => {
    useAppStore.getState().openTelescopeTab('c1')
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].kind).toBe('telescope')
    expect(s.tabs[0].title).toBe('🔭 Telescope')
    expect(s.activeTabId).toBe(s.tabs[0].id)
    expect(s.activeConnectionId).toBe('c1')
  })

  it('focuses the existing telescope tab instead of duplicating (one per connection)', () => {
    useAppStore.getState().openTelescopeTab('c1')
    const firstId = useAppStore.getState().tabs[0].id
    useAppStore.getState().openQueryTab({ connectionId: 'c1' }) // switch active away
    useAppStore.getState().openTelescopeTab('c1')
    const s = useAppStore.getState()
    expect(s.tabs.filter((t) => t.kind === 'telescope')).toHaveLength(1)
    expect(s.activeTabId).toBe(firstId)
  })

  it('gives separate connections their own telescope tabs', () => {
    useAppStore.getState().openTelescopeTab('c1')
    useAppStore.getState().openTelescopeTab('c2')
    expect(useAppStore.getState().tabs.filter((t) => t.kind === 'telescope')).toHaveLength(2)
  })

  it('openOrLoadQuery does not hijack a telescope tab — opens a new query tab', () => {
    useAppStore.getState().openTelescopeTab('c1')
    useAppStore.getState().openOrLoadQuery({ connectionId: 'c1', title: 'Saved', text: 'SELECT 1' })
    const s = useAppStore.getState()
    expect(s.tabs).toHaveLength(2)
    const active = s.tabs.find((t) => t.id === s.activeTabId)!
    expect(active.kind == null || active.kind === 'query').toBe(true)
    expect(active.text).toBe('SELECT 1')
  })
})
