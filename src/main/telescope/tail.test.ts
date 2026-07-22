import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TelescopeTailManager } from './tail'
import type { TelescopeEntry, TelescopeNewEntriesEvent } from '../../shared/telescope'

const mkEntry = (seq: string): TelescopeEntry => ({
  sequence: seq, uuid: `u${seq}`, batchId: 'b', familyHash: null, type: 'request', createdAt: null,
  summary: { type: 'request', method: 'GET', uri: '/', status: 200, duration: 1 }
})

describe('TelescopeTailManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('seeds from the current max, then emits only newer entries and advances the cursor', async () => {
    const emitted: TelescopeNewEntriesEvent[] = []
    const fetchSince = vi.fn(async (_id: string, seq: string) => {
      if (seq === '0') return [mkEntry('100')] // seed → max is 100 (NOT emitted)
      if (seq === '100') return [mkEntry('102'), mkEntry('101')] // newer, DESC
      return [] // seq '102' → nothing new
    })
    const mgr = new TelescopeTailManager({ fetchSince, emit: (e) => emitted.push(e), intervalMs: 3000 })

    await mgr.start('c1')
    expect(emitted).toHaveLength(0) // seeding emits nothing

    await vi.advanceTimersByTimeAsync(3000) // poll 1 → fetchSince('c1','100')
    expect(emitted).toEqual([{ connectionId: 'c1', entries: [mkEntry('102'), mkEntry('101')] }])

    await vi.advanceTimersByTimeAsync(3000) // poll 2 → fetchSince('c1','102') → []
    expect(emitted).toHaveLength(1) // cursor advanced past 102, nothing new

    mgr.stopAll()
  })

  it('stop() halts further polling', async () => {
    const fetchSince = vi.fn(async () => [] as TelescopeEntry[])
    const mgr = new TelescopeTailManager({ fetchSince, emit: () => {}, intervalMs: 1000 })
    await mgr.start('c1')
    const afterSeed = fetchSince.mock.calls.length
    mgr.stop('c1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchSince.mock.calls.length).toBe(afterSeed)
  })

  it('pauseAll/resumeAll suspends and resumes polling without losing the cursor', async () => {
    const fetchSince = vi.fn(async () => [] as TelescopeEntry[])
    const mgr = new TelescopeTailManager({ fetchSince, emit: () => {}, intervalMs: 1000 })
    await mgr.start('c1')
    const afterSeed = fetchSince.mock.calls.length
    mgr.pauseAll()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchSince.mock.calls.length).toBe(afterSeed) // paused → no polls
    mgr.resumeAll()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSince.mock.calls.length).toBe(afterSeed + 1) // one poll after resume
    mgr.stopAll()
  })

  it('start() is idempotent (one subscription per connection)', async () => {
    const fetchSince = vi.fn(async () => [] as TelescopeEntry[])
    const mgr = new TelescopeTailManager({ fetchSince, emit: () => {}, intervalMs: 1000 })
    await mgr.start('c1')
    await mgr.start('c1') // no-op
    const seedCalls = fetchSince.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSince.mock.calls.length).toBe(seedCalls + 1) // a single timer, not two
    mgr.stopAll()
  })
})
