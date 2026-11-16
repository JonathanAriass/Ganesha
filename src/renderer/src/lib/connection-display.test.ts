import { describe, expect, it } from 'vitest'
import {
  connectionAccessibleName,
  connectionHostText,
  connectionInitials,
  connectionModeText
} from './connection-display'

describe('connectionInitials', () => {
  it('uses the first letters of the first two words', () => {
    expect(connectionInitials('orders-prod')).toBe('OP')
    expect(connectionInitials('analytics mongo db')).toBe('AM')
    expect(connectionInitials('  blog_db  ')).toBe('BD')
    expect(connectionInitials('3d-store')).toBe('3S')
  })
  it('uses the first two letters of a single word', () => {
    expect(connectionInitials('local')).toBe('LO')
    expect(connectionInitials('x')).toBe('X')
  })
  it('falls back to ? when there is nothing alphanumeric', () => {
    expect(connectionInitials('—')).toBe('?')
    expect(connectionInitials('🚀')).toBe('?')
    expect(connectionInitials('')).toBe('?')
  })
})

describe('connectionModeText', () => {
  it('describes the write mode', () => {
    expect(connectionModeText({ readOnly: true, requireCommit: true })).toBe('Read-only — writes are blocked')
    expect(connectionModeText({ readOnly: false, requireCommit: true })).toBe('Edits stage until you commit')
    expect(connectionModeText({ readOnly: false, requireCommit: false })).toBe('')
  })
})

describe('connectionAccessibleName', () => {
  it('adds the environment in parentheses and the read-only mode', () => {
    expect(connectionAccessibleName({ name: 'orders-prod', environment: 'PROD', readOnly: true })).toBe(
      'orders-prod (PROD), read-only'
    )
  })
  it('adds only the environment when the connection is writable', () => {
    expect(connectionAccessibleName({ name: 'orders-stg', environment: 'STG', readOnly: false })).toBe('orders-stg (STG)')
  })
  it('is just the name with no environment and writable', () => {
    expect(connectionAccessibleName({ name: 'local-dev', environment: '', readOnly: false })).toBe('local-dev')
  })
  it('adds only read-only when there is no environment', () => {
    expect(connectionAccessibleName({ name: 'blog-db', environment: '', readOnly: true })).toBe('blog-db, read-only')
  })
})

describe('connectionHostText', () => {
  it('joins type and host:port', () => {
    expect(connectionHostText({ type: 'postgres', host: 'db.internal', port: 5432 })).toBe('postgres · db.internal:5432')
  })
})
