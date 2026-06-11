import { describe, it, expect } from 'vitest'
import { resolveShortcut } from './shortcuts'

const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }

describe('resolveShortcut', () => {
  it('maps mod+k to palette for both meta and ctrl', () => {
    expect(resolveShortcut({ ...base, key: 'k', metaKey: true })).toBe('palette')
    expect(resolveShortcut({ ...base, key: 'k', ctrlKey: true })).toBe('palette')
  })

  it('maps mod+t, mod+w and mod+, to tab/settings actions', () => {
    expect(resolveShortcut({ ...base, key: 't', metaKey: true })).toBe('new-tab')
    expect(resolveShortcut({ ...base, key: 'w', metaKey: true })).toBe('close-tab')
    expect(resolveShortcut({ ...base, key: ',', ctrlKey: true })).toBe('settings')
  })

  it('maps mod+s to save-query', () => {
    expect(resolveShortcut({ ...base, key: 's', metaKey: true })).toBe('save-query')
    expect(resolveShortcut({ ...base, key: 's', ctrlKey: true })).toBe('save-query')
  })

  it('is case-insensitive on the key', () => {
    expect(resolveShortcut({ ...base, key: 'W', metaKey: true })).toBe('close-tab')
  })

  it('requires a modifier', () => {
    expect(resolveShortcut({ ...base, key: 'k' })).toBeNull()
  })

  it('rejects alt and shift chords (Shift+mod+W stays the menu window-close)', () => {
    expect(resolveShortcut({ ...base, key: 'k', metaKey: true, altKey: true })).toBeNull()
    expect(resolveShortcut({ ...base, key: 'w', metaKey: true, shiftKey: true })).toBeNull()
  })

  it('ignores unmapped keys', () => {
    expect(resolveShortcut({ ...base, key: 'p', metaKey: true })).toBeNull()
  })
})
