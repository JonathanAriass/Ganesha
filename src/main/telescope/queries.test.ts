import { describe, it, expect } from 'vitest'
import {
  buildEntriesQuery, buildEntryQuery, buildRelatedQuery, buildTagsQuery, buildTailQuery,
  DEFAULT_LIST_LIMIT, RELATED_LIMIT, TAIL_LIMIT
} from './queries'

describe('buildEntriesQuery — plain type list', () => {
  it('type, no cursor → [type, limit], keyset order, display filter', () => {
    const { sql, params } = buildEntriesQuery({ type: 'request' })
    expect(params).toEqual(['request', DEFAULT_LIST_LIMIT])
    expect(sql).toContain('should_display_on_index = 1')
    expect(sql).toContain('`type` = ?')
    expect(sql).toContain('ORDER BY sequence DESC LIMIT ?')
    expect(sql).not.toContain('OFFSET')
    expect(sql).not.toContain('JOIN')
  })
  it('type + cursor → [type, cursor, limit] with sequence < ?', () => {
    const { sql, params } = buildEntriesQuery({ type: 'query', beforeSequence: '9999', limit: 25 })
    expect(params).toEqual(['query', '9999', 25])
    expect(sql).toContain('sequence < ?')
  })
})

describe('buildEntriesQuery — search branch (type dropped)', () => {
  it('search present → LIKE + recent-window guard, type NOT bound, params [search, limit]', () => {
    const { sql, params } = buildEntriesQuery({ type: 'request', search: 'boom' })
    expect(params).toEqual(['boom', DEFAULT_LIST_LIMIT])
    expect(sql).toContain("CONCAT('%', ?, '%')")
    expect(sql).toContain('MAX(sequence) - 10000')
    expect(sql).not.toContain('e.`type` = ?') // type filter dropped when searching
  })
  it('search + cursor → [search, cursor, limit]', () => {
    const { params } = buildEntriesQuery({ type: null, search: 'x', beforeSequence: '500' })
    expect(params).toEqual(['x', '500', DEFAULT_LIST_LIMIT])
  })
})

describe('buildEntriesQuery — tag branch', () => {
  it('tag only (no search) → JOIN + DISTINCT + type kept, params [tag, type, limit]', () => {
    const { sql, params } = buildEntriesQuery({ type: 'query', tag: 'slow' })
    expect(params).toEqual(['slow', 'query', DEFAULT_LIST_LIMIT])
    expect(sql).toContain('INNER JOIN telescope_entries_tags t ON t.entry_uuid = e.uuid')
    expect(sql).toContain('SELECT DISTINCT')
    expect(sql).toContain('t.tag = ?')
    expect(sql).toContain('e.`type` = ?')
  })
  it('tag + search → bind order [tag, search, limit], type dropped', () => {
    const { sql, params } = buildEntriesQuery({ type: 'request', tag: 'slow', search: 'q' })
    expect(params).toEqual(['slow', 'q', DEFAULT_LIST_LIMIT])
    expect(sql).toContain('SELECT DISTINCT')
    expect(sql).toContain("CONCAT('%', ?, '%')")
    expect(sql).not.toContain('e.`type` = ?')
  })
})

describe('single-purpose queries', () => {
  it('buildEntryQuery by uuid', () => {
    expect(buildEntryQuery('u-1')).toEqual({ sql: expect.stringContaining('WHERE uuid = ?'), params: ['u-1'] })
  })
  it('buildRelatedQuery: ASC, no display filter, default limit 101', () => {
    const { sql, params } = buildRelatedQuery('b-1')
    expect(params).toEqual(['b-1', RELATED_LIMIT])
    expect(sql).toContain('ORDER BY sequence ASC')
    expect(sql).not.toContain('should_display_on_index')
  })
  it('buildRelatedQuery with excludeUuid → [batchId, uuid, limit]', () => {
    const { sql, params } = buildRelatedQuery('b-1', 'u-9', 50)
    expect(params).toEqual(['b-1', 'u-9', 50])
    expect(sql).toContain('uuid != ?')
  })
  it('buildTagsQuery is distinct + ordered', () => {
    expect(buildTagsQuery().sql).toBe('SELECT DISTINCT tag FROM telescope_entries_tags ORDER BY tag ASC')
  })
  it('buildTailQuery: newer-than cursor, DESC, default limit 100', () => {
    const { sql, params } = buildTailQuery('123')
    expect(params).toEqual(['123', TAIL_LIMIT])
    expect(sql).toContain('sequence > ?')
    expect(sql).toContain('ORDER BY sequence DESC')
  })
})
