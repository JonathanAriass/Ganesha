import { describe, it, expect } from 'vitest'
import {
  formatDuration, formatRelativeTime,
  statusTone, logLevelTone, jobStatusTone, cacheTypeTone, gateResultTone, exitCodeTone
} from './telescope-format'
import { typeConfig, detailTabs } from './telescope-types'

describe('formatDuration', () => {
  it('picks µs / ms / s buckets', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(0.5)).toBe('500μs')
    expect(formatDuration(12.34)).toBe('12.3ms')
    expect(formatDuration(2500)).toBe('2.50s')
  })
})

describe('formatRelativeTime', () => {
  it('buckets recent timestamps', () => {
    expect(formatRelativeTime(new Date(Date.now() - 90_000).toISOString())).toBe('1m ago')
    expect(formatRelativeTime(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe('2h ago')
  })
  it('handles null + garbage', () => {
    expect(formatRelativeTime(null)).toBe('')
    expect(formatRelativeTime('not a date')).toBe('not a date')
  })
  it('parses MySQL space-separated timestamps as UTC', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString() // 2026-...T...Z
    const mysqlStyle = iso.slice(0, 19).replace('T', ' ') // 'YYYY-MM-DD HH:MM:SS' (UTC wall clock)
    expect(formatRelativeTime(mysqlStyle)).toBe('5m ago')
  })
})

describe('badge tones', () => {
  it('HTTP status', () => {
    expect(statusTone(200)).toBe('ok')
    expect(statusTone(301)).toBe('warn')
    expect(statusTone(404)).toBe('danger')
    expect(statusTone(500)).toBe('danger')
    expect(statusTone(100)).toBe('muted')
  })
  it('log level', () => {
    expect(logLevelTone('debug')).toBe('muted')
    expect(logLevelTone('info')).toBe('info')
    expect(logLevelTone('warning')).toBe('warn')
    expect(logLevelTone('critical')).toBe('danger')
  })
  it('job / cache / gate / exit code', () => {
    expect(jobStatusTone('processed')).toBe('ok')
    expect(jobStatusTone('failed')).toBe('danger')
    expect(cacheTypeTone('hit')).toBe('ok')
    expect(cacheTypeTone('missed')).toBe('danger')
    expect(cacheTypeTone('set')).toBe('info')
    expect(gateResultTone('allowed')).toBe('ok')
    expect(gateResultTone('denied')).toBe('danger')
    expect(exitCodeTone(0)).toBe('ok')
    expect(exitCodeTone(1)).toBe('danger')
  })
})

describe('type registry', () => {
  it('known type config + unknown fallback', () => {
    expect(typeConfig('request').label).toBe('Requests')
    expect(typeConfig('mystery')).toEqual({ type: 'mystery', label: 'mystery', icon: '•' })
  })
  it('detail tabs incl. fallback', () => {
    expect(detailTabs('request')).toEqual(['Headers', 'Payload', 'Response'])
    expect(detailTabs('mystery')).toEqual(['Details'])
  })
})
