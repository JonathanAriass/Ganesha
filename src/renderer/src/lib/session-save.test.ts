import { describe, it, expect, vi } from 'vitest'
import type { SessionTab } from '@shared/domain'
import type { QueryTabData } from '../state/store'
import { makeSessionSaver, toSessionTabs } from './session-save'

function tab(over: Partial<QueryTabData> & { id: string }): QueryTabData {
  return {
    connectionId: 'c1', title: 'Query 1', text: 'SELECT 1', epoch: 0, runOnOpen: false,
    running: false, queryId: null, result: null, error: null, scriptRun: null, edits: {}, editError: null, ...over
  }
}

function session(over: Partial<SessionTab> & { id: string }): SessionTab {
  return { connectionId: 'c1', title: 'Query 1', text: 'SELECT 1', active: false, ...over }
}

describe('toSessionTabs', () => {
  it('projects text-only fields and flags the active tab', () => {
    const tabs = [tab({ id: 'a' }), tab({ id: 'b', title: 'mine', text: '' })]
    expect(toSessionTabs(tabs, 'b')).toEqual([
      { id: 'a', connectionId: 'c1', title: 'Query 1', text: 'SELECT 1', active: false },
      { id: 'b', connectionId: 'c1', title: 'mine', text: '', active: true }
    ])
  })

  it('flags nothing when no tab is active', () => {
    expect(toSessionTabs([tab({ id: 'a' })], null).map((t) => t.active)).toEqual([false])
  })
})

describe('makeSessionSaver', () => {
  it('writes a changed strip and dedups the unchanged one', () => {
    const write = vi.fn()
    const saver = makeSessionSaver(write)
    saver.save([session({ id: 'a' })])
    saver.save([session({ id: 'a' })])
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a flush before the restore resolves must not wipe the saved session', () => {
    // Boot baseline is the EMPTY strip: saving [] with no restore seeded and no
    // user action is a no-information write and must be skipped (else a quit
    // inside the boot round-trip deletes every session_tabs row).
    const write = vi.fn()
    makeSessionSaver(write).save([])
    expect(write).not.toHaveBeenCalled()
  })

  it('skips the boot echo after seeding disk truth', () => {
    const write = vi.fn()
    const saver = makeSessionSaver(write)
    const disk = [session({ id: 'a', active: true })]
    saver.seedFromDisk(disk)
    saver.save(disk) // hydrate echoes the restored strip back
    expect(write).not.toHaveBeenCalled()
  })

  it('still saves user tabs after a no-op hydrate (seed differs from state)', () => {
    const write = vi.fn()
    const saver = makeSessionSaver(write)
    saver.seedFromDisk([session({ id: 'old' })])
    saver.save([session({ id: 'user-tab' })])
    expect(write).toHaveBeenCalledWith([session({ id: 'user-tab' })])
  })

  it('a stale seed cannot overwrite a save that beat a slow restore', () => {
    const write = vi.fn()
    const saver = makeSessionSaver(write)
    saver.save([session({ id: 'user-tab' })]) // throttled save fired first
    saver.seedFromDisk([session({ id: 'old' })]) // restore resolves late — ignored
    saver.save([session({ id: 'user-tab' })])
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a skipped save does not poison a later seed — savedOnce counts real writes only', () => {
    const write = vi.fn()
    const saver = makeSessionSaver(write)
    saver.save([]) // boot flush before restore: skipped, must not count as a save
    saver.seedFromDisk([session({ id: 'a' })]) // restore lands after — seed must still apply
    saver.save([session({ id: 'a' })]) // hydrate echo: skipped
    expect(write).not.toHaveBeenCalled()
    saver.save([session({ id: 'a' }), session({ id: 'b' })]) // real change still writes
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a deliberate close-all after restore still clears disk', () => {
    const write = vi.fn()
    const saver = makeSessionSaver(write)
    saver.seedFromDisk([session({ id: 'a' })])
    saver.save([])
    expect(write).toHaveBeenCalledWith([])
  })
})
