import { describe, it, expect } from 'vitest'
import { toSessionTabs, makeSessionSaver } from './session-save'
import type { SessionTab } from '@shared/domain'
import type { QueryTabData } from '../state/store'

const base = (over: Partial<QueryTabData> & { id: string; connectionId: string; pane: 'left' | 'right' }): QueryTabData => ({
  title: 'Q', text: 't', kind: undefined, epoch: 0, runOnOpen: false, running: false,
  queryId: null, result: null, resultQueryId: null, hasMore: false, loadingMore: false,
  filter: '', filterMode: { caseSensitive: false, wholeWord: false, regex: false }, columnFilters: {}, filterView: null,
  error: null, scriptRun: null, edits: {}, editError: null, ...over,
})

describe('toSessionTabs', () => {
  it('flags each pane’s active tab and emits pane', () => {
    const tabs = [
      base({ id: 'a', connectionId: 'c1', pane: 'left' }),
      base({ id: 'b', connectionId: 'c1', pane: 'right' }),
    ]
    const out = toSessionTabs(tabs, { left: 'a', right: 'b' })
    expect(out).toEqual([
      { id: 'a', connectionId: 'c1', title: 'Q', text: 't', pane: 'left', active: true },
      { id: 'b', connectionId: 'c1', title: 'Q', text: 't', pane: 'right', active: true },
    ])
  })

  it('skips diagram tabs', () => {
    const tabs = [base({ id: 'd', connectionId: 'c1', pane: 'left', kind: 'diagram' })]
    expect(toSessionTabs(tabs, { left: 'd', right: null })).toEqual([])
  })

  it('only the per-pane active tab is flagged', () => {
    const tabs = [
      base({ id: 'a', connectionId: 'c1', pane: 'left' }),
      base({ id: 'b', connectionId: 'c1', pane: 'left' }),
    ]
    const out = toSessionTabs(tabs, { left: 'b', right: null })
    expect(out.map((t) => t.active)).toEqual([false, true])
  })
})

describe('makeSessionSaver', () => {
  const t = (id: string): SessionTab => ({ id, connectionId: 'c1', title: 'Q', text: 't', pane: 'left', active: false })
  it('writes once, then skips an identical save (fingerprint)', () => {
    const writes: SessionTab[][] = []
    const saver = makeSessionSaver((tabs) => writes.push(tabs))
    saver.save([t('a')])
    saver.save([t('a')]) // identical → skipped
    saver.save([t('b')]) // different → written
    expect(writes).toHaveLength(2)
  })
  it('seedFromDisk suppresses the boot echo', () => {
    const writes: SessionTab[][] = []
    const saver = makeSessionSaver((tabs) => writes.push(tabs))
    saver.seedFromDisk([t('a')])
    saver.save([t('a')]) // matches disk seed → skipped
    expect(writes).toHaveLength(0)
  })
})
