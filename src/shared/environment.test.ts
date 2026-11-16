import { describe, it, expect } from 'vitest'
import { cleanEnvironment, ENVIRONMENT_MAX_LENGTH, ENVIRONMENT_SUGGESTIONS } from './environment'

describe('cleanEnvironment', () => {
  it('trims', () => expect(cleanEnvironment('  PROD  ')).toBe('PROD'))
  it('cuts to the max length', () => {
    expect(ENVIRONMENT_MAX_LENGTH).toBe(12)
    expect(cleanEnvironment('a-very-long-environment')).toBe('a-very-long-')
  })
  it('returns empty for empty and non-string input', () => {
    expect(cleanEnvironment('')).toBe('')
    expect(cleanEnvironment(undefined)).toBe('')
    expect(cleanEnvironment(123)).toBe('')
  })
  it('keeps the case as typed', () => expect(cleanEnvironment('stg')).toBe('stg'))
  it('exposes the suggestions', () => expect([...ENVIRONMENT_SUGGESTIONS]).toEqual(['PROD', 'STG', 'DEV', 'LOCAL']))
})
