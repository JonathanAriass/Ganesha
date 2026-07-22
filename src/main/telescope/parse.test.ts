import { describe, it, expect } from 'vitest'
import { parseEntrySummary, parseEntryDetail, parseTime, trunc, shortClass, stripHtml } from './parse'

describe('helpers', () => {
  it('parseTime: number, comma-string, plain string, garbage', () => {
    expect(parseTime(12.5)).toBe(12.5)
    expect(parseTime('1,234.56')).toBeCloseTo(1234.56)
    expect(parseTime('42.1')).toBeCloseTo(42.1)
    expect(parseTime('n/a')).toBe(0)
    expect(parseTime(null)).toBe(0)
    expect(parseTime(undefined)).toBe(0)
  })
  it('trunc keeps short, ellipsizes long', () => {
    expect(trunc('abc', 5)).toBe('abc')
    expect(trunc('abcdef', 3)).toBe('abc...')
  })
  it('shortClass takes the segment after the last backslash', () => {
    expect(shortClass('App\\Notifications\\OrderShipped')).toBe('OrderShipped')
    expect(shortClass('NoNamespace')).toBe('NoNamespace')
  })
  it('trunc counts code points and never splits a surrogate pair', () => {
    expect(trunc('😀😀😀', 2)).toBe('😀😀...') // whole emoji kept, no lone surrogate
    expect(trunc('😀😀', 5)).toBe('😀😀')
  })
  it('stripHtml removes tags', () => {
    expect(stripHtml('<span class="x">hi</span> there')).toBe('hi there')
  })
})

describe('parseEntrySummary', () => {
  it('request reads snake_case response_status + uri + duration', () => {
    expect(parseEntrySummary('request', { method: 'GET', uri: '/api/users', response_status: 200, duration: '12.5' }))
      .toEqual({ type: 'request', method: 'GET', uri: '/api/users', status: 200, duration: 12.5 })
  })
  it('query truncates sql(200) and reads time as duration', () => {
    const sql = 'x'.repeat(250)
    const s = parseEntrySummary('query', { sql, time: 3.2, connection: 'mysql' })
    expect(s).toMatchObject({ type: 'query', duration: 3.2, connection: 'mysql' })
    expect((s as { sql: string }).sql).toHaveLength(203) // 200 + '...'
  })
  it('exception truncates message to 200', () => {
    const s = parseEntrySummary('exception', { class: 'RuntimeException', message: 'y'.repeat(300) })
    expect(s).toMatchObject({ type: 'exception', class: 'RuntimeException' })
    expect((s as { message: string }).message).toHaveLength(203)
  })
  it('mail reads to[0].address, defaults to unknown', () => {
    expect(parseEntrySummary('mail', { subject: 'Hi', to: [{ address: 'a@b.com' }] }))
      .toEqual({ type: 'mail', subject: 'Hi', to: 'a@b.com' })
    expect(parseEntrySummary('mail', { subject: 'Hi' })).toEqual({ type: 'mail', subject: 'Hi', to: 'unknown' })
    // present-but-empty address stays '' (only an absent/non-string address defaults to 'unknown')
    expect(parseEntrySummary('mail', { subject: 'Hi', to: [{ address: '' }] })).toEqual({ type: 'mail', subject: 'Hi', to: '' })
  })
  it('cache maps JSON `type` to cacheType', () => {
    expect(parseEntrySummary('cache', { key: 'k', type: 'hit' })).toEqual({ type: 'cache', key: 'k', cacheType: 'hit' })
  })
  it('command reads exit_code', () => {
    expect(parseEntrySummary('command', { command: 'migrate', exit_code: 0 })).toEqual({ type: 'command', command: 'migrate', exitCode: 0 })
  })
  it('redis keeps time as a string and defaults to "0"', () => {
    expect(parseEntrySummary('redis', { command: 'GET x', time: '1.20' })).toEqual({ type: 'redis', command: 'GET x', duration: '1.20' })
    expect(parseEntrySummary('redis', { command: 'GET x' })).toEqual({ type: 'redis', command: 'GET x', duration: '0' })
  })
  it('notification/model/event use shortClass', () => {
    expect(parseEntrySummary('notification', { notification: 'App\\Notifications\\Ping', channel: 'mail' }))
      .toEqual({ type: 'notification', notification: 'Ping', channel: 'mail' })
    expect(parseEntrySummary('event', { name: 'App\\Events\\Ordered', listeners: [1, 2, 3] }))
      .toEqual({ type: 'event', name: 'Ordered', listenerCount: 3 })
  })
  it('batch reads camelCase totalJobs + progress', () => {
    expect(parseEntrySummary('batch', { name: 'Import', progress: 40, totalJobs: 10 }))
      .toEqual({ type: 'batch', name: 'Import', progress: 40, totalJobs: 10 })
  })
  it('unknown type falls back to generic preview (100 chars)', () => {
    const s = parseEntrySummary('mystery', { a: 1 })
    expect(s.type).toBe('generic')
  })
})

describe('parseEntryDetail', () => {
  it('request maps snake_case → camelCase', () => {
    const d = parseEntryDetail('request', {
      uri: '/x', method: 'POST', controller_action: 'C@a', middleware: ['auth'],
      headers: { h: 'v' }, payload: { a: 1 }, response_status: 201, response: '{"ok":true}', duration: '5.0', memory: 2.5, hostname: 'web1'
    })
    expect(d).toMatchObject({
      type: 'request', uri: '/x', method: 'POST', controllerAction: 'C@a', middleware: ['auth'],
      headers: { h: 'v' }, payload: { a: 1 }, responseStatus: 201, response: '{"ok":true}', duration: 5, memory: 2.5, hostname: 'web1'
    })
  })
  it('cache detail maps type → cacheType', () => {
    expect(parseEntryDetail('cache', { type: 'set', key: 'k', value: 1 })).toMatchObject({ type: 'cache', cacheType: 'set', key: 'k' })
  })
  it('command detail maps exit_code → exitCode', () => {
    expect(parseEntryDetail('command', { command: 'q', exit_code: 2 })).toMatchObject({ type: 'command', exitCode: 2 })
  })
  it('redis detail keeps time as string', () => {
    expect(parseEntryDetail('redis', { command: 'GET', time: '0.10' })).toMatchObject({ type: 'redis', time: '0.10' })
  })
  it('unknown type → raw with the original object', () => {
    expect(parseEntryDetail('mystery', { a: 1 })).toEqual({ type: 'raw', data: { a: 1 } })
  })
  it('non-object content degrades to a raw view of the original source (known + unknown types)', () => {
    expect(parseEntryDetail('request', null)).toEqual({ type: 'raw', data: null })
    expect(parseEntryDetail('query', 'boom')).toEqual({ type: 'raw', data: 'boom' })
    expect(parseEntryDetail('mystery', 'a string')).toEqual({ type: 'raw', data: 'a string' })
    expect(parseEntryDetail('mystery', [1, 2])).toEqual({ type: 'raw', data: [1, 2] })
  })
})
