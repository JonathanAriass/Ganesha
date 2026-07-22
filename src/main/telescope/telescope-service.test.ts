import { describe, it, expect } from 'vitest'
import { detectTelescope, listEntries, getEntry, getRelated, getTags, tailSince, type TelescopeReader } from './telescope-service'

function reader(opts: {
  objects?: string[]
  rows?: Record<string, unknown>[]
  noQueryRaw?: boolean
  capture?: (sql: string, params: unknown[]) => void
}): TelescopeReader {
  const r: TelescopeReader = {
    listObjects: async () => (opts.objects ?? []).map((name) => ({ name }))
  }
  if (!opts.noQueryRaw) {
    r.queryRaw = async (_id, sql, params = []) => { opts.capture?.(sql, params); return opts.rows ?? [] }
  }
  return r
}

const entryRow = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  sequence: 100, uuid: 'u1', batch_id: 'b1', family_hash: null, type: 'request',
  content: JSON.stringify({ method: 'GET', uri: '/x', response_status: 200, duration: 5 }),
  created_at: '2026-07-22 10:00:00', ...over
})

describe('detectTelescope', () => {
  it('installed when telescope_entries present', async () => {
    expect(await detectTelescope(reader({ objects: ['users', 'telescope_entries', 'telescope_entries_tags'] }), 'c'))
      .toEqual({ installed: true, present: ['telescope_entries', 'telescope_entries_tags'] })
  })
  it('not installed when absent', async () => {
    expect(await detectTelescope(reader({ objects: ['users'] }), 'c')).toEqual({ installed: false, present: [] })
  })
})

describe('listEntries', () => {
  it('maps rows, keeps sequence as string, computes hasMore + nextCursor', async () => {
    const rows = [entryRow({ sequence: 100, uuid: 'a' }), entryRow({ sequence: 99, uuid: 'b' })]
    const page = await listEntries(reader({ rows }), 'c', { type: 'request', limit: 2 })
    expect(page.entries).toHaveLength(2)
    expect(page.entries[0].sequence).toBe('100')
    expect(typeof page.entries[0].sequence).toBe('string')
    expect(page.entries[0].summary).toEqual({ type: 'request', method: 'GET', uri: '/x', status: 200, duration: 5 })
    expect(page.hasMore).toBe(true) // rows.length === limit
    expect(page.nextCursor).toBe('99')
  })
  it('hasMore false + nextCursor null when fewer than limit / empty', async () => {
    const page = await listEntries(reader({ rows: [] }), 'c', { type: 'request', limit: 50 })
    expect(page).toEqual({ entries: [], hasMore: false, nextCursor: null })
  })
  it('passes cursor + limit through to the query', async () => {
    let captured: unknown[] = []
    await listEntries(reader({ rows: [], capture: (_s, p) => (captured = p) }), 'c', { type: 'query', beforeSequence: '50', limit: 10 })
    expect(captured).toEqual(['query', '50', 10])
  })
})

describe('getEntry / getRelated / getTags / tailSince', () => {
  it('getEntry returns null when no row, detail when present', async () => {
    expect(await getEntry(reader({ rows: [] }), 'c', 'u1')).toBeNull()
    const d = await getEntry(reader({ rows: [entryRow()] }), 'c', 'u1')
    expect(d?.content).toMatchObject({ type: 'request', uri: '/x', responseStatus: 200 })
  })
  it('getRelated maps sibling rows', async () => {
    const rel = await getRelated(reader({ rows: [entryRow({ type: 'query', content: JSON.stringify({ sql: 'SELECT 1', time: 2 }) })] }), 'c', 'b1')
    expect(rel[0].summary).toMatchObject({ type: 'query', duration: 2 })
  })
  it('getTags extracts the tag column', async () => {
    expect(await getTags(reader({ rows: [{ tag: 'slow' }, { tag: 'auth' }] }), 'c')).toEqual(['slow', 'auth'])
  })
  it('tailSince maps newer entries', async () => {
    const t = await tailSince(reader({ rows: [entryRow({ sequence: 200 })] }), 'c', '199')
    expect(t[0].sequence).toBe('200')
  })
  it('throws a helpful error when the driver has no queryRaw (e.g. Mongo)', async () => {
    await expect(listEntries(reader({ noQueryRaw: true }), 'c', { type: 'request' })).rejects.toThrow(/requires a SQL/)
  })
})

describe('content parsing robustness', () => {
  it('tolerates malformed content JSON (→ empty summary fields)', async () => {
    const page = await listEntries(reader({ rows: [entryRow({ content: '{not json' })] }), 'c', { type: 'request', limit: 50 })
    expect(page.entries[0].summary).toEqual({ type: 'request', method: '', uri: '', status: 0, duration: 0 })
  })
  it('accepts already-parsed object content (jsonb-style)', async () => {
    const page = await listEntries(reader({ rows: [entryRow({ content: { method: 'POST', uri: '/y', response_status: 201, duration: 3 } })] }), 'c', { type: 'request', limit: 50 })
    expect(page.entries[0].summary).toMatchObject({ method: 'POST', status: 201 })
  })
})
