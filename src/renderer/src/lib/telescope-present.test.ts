import { describe, it, expect } from 'vitest'
import type { TelescopeEntry, EntrySummary } from '@shared/telescope'
import { entryPrimary, entrySecondary, entryBadge, entryTitle, entryMethod, entryIcon } from './telescope-present'

// createdAt null → entrySecondary omits the trailing relative-time part (keeps tests time-independent).
const entry = (summary: EntrySummary): TelescopeEntry => ({
  sequence: '1', uuid: 'u', batchId: 'b', familyHash: null, type: summary.type, createdAt: null, summary
})

describe('entry presenters', () => {
  it('request: title = method + uri, badge from status, method prefix', () => {
    const e = entry({ type: 'request', method: 'GET', uri: '/api/users', status: 200, duration: 5 })
    expect(entryTitle(e)).toBe('GET /api/users')
    expect(entryMethod(e)).toBe('GET')
    expect(entryPrimary(e)).toBe('/api/users')
    expect(entryBadge(e)).toEqual({ text: '200', tone: 'ok' })
    expect(entrySecondary(e)).toEqual(['5.0ms'])
  })
  it('query: no badge, secondary is duration + connection', () => {
    const e = entry({ type: 'query', sql: 'SELECT 1', duration: 2, connection: 'mysql' })
    expect(entryBadge(e)).toBeNull()
    expect(entrySecondary(e)).toEqual(['2.0ms', 'mysql'])
    expect(entryPrimary(e)).toBe('SELECT 1')
  })
  it('log: badge tone follows level', () => {
    expect(entryBadge(entry({ type: 'log', level: 'error', message: 'boom' }))).toEqual({ text: 'error', tone: 'danger' })
  })
  it('exception: no method prefix, title = class', () => {
    const e = entry({ type: 'exception', class: 'RuntimeException', message: 'x' })
    expect(entryMethod(e)).toBeNull()
    expect(entryTitle(e)).toBe('RuntimeException')
  })
  it('command: exit-code badge tone', () => {
    expect(entryBadge(entry({ type: 'command', command: 'migrate', exitCode: 0 }))).toEqual({ text: 'exit 0', tone: 'ok' })
    expect(entryBadge(entry({ type: 'command', command: 'migrate', exitCode: 1 }))).toEqual({ text: 'exit 1', tone: 'danger' })
  })
  it('redis renders duration string, generic falls back to preview + icon', () => {
    expect(entrySecondary(entry({ type: 'redis', command: 'GET x', duration: '1.2' }))).toEqual(['1.2ms'])
    expect(entrySecondary(entry({ type: 'redis', command: 'GET x', duration: '' }))).toEqual([]) // empty → no bare 'ms'
    expect(entryPrimary(entry({ type: 'generic', preview: 'blob' }))).toBe('blob')
    expect(entryIcon(entry({ type: 'request', method: 'GET', uri: '/', status: 200, duration: 1 }))).toBe('🌐')
  })
})
