import { describe, it, expect } from 'vitest'
import { parseVersion, isNewerVersion, checkForUpdate } from './update-check'

describe('parseVersion', () => {
  it('parses plain, v-prefixed, and suffixed versions', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3])
    expect(parseVersion('2.0')).toEqual([2, 0, 0])
  })
})

describe('isNewerVersion', () => {
  it('compares major, then minor, then patch', () => {
    expect(isNewerVersion('1.0.4', '1.0.3')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.0.3', '1.0.3')).toBe(false) // equal
    expect(isNewerVersion('1.0.2', '1.0.3')).toBe(false) // older
    expect(isNewerVersion('v1.0.4', '1.0.3')).toBe(true) // v-prefix tolerated
  })
})

describe('checkForUpdate', () => {
  const ok = (tag: string) => async () => ({ tag_name: tag, html_url: `https://x/releases/${tag}` })

  it('returns the update when the release is newer', async () => {
    const u = await checkForUpdate('1.0.3', 'o/r', ok('v1.0.4'))
    expect(u).toEqual({ version: '1.0.4', url: 'https://x/releases/v1.0.4' })
  })

  it('returns null when up-to-date or older', async () => {
    expect(await checkForUpdate('1.0.3', 'o/r', ok('v1.0.3'))).toBeNull()
    expect(await checkForUpdate('1.0.3', 'o/r', ok('v1.0.2'))).toBeNull()
  })

  it('returns null on a missing tag or a fetch failure', async () => {
    expect(await checkForUpdate('1.0.3', 'o/r', async () => ({}))).toBeNull()
    expect(await checkForUpdate('1.0.3', 'o/r', async () => { throw new Error('offline') })).toBeNull()
  })

  it('falls back to the releases/latest URL when html_url is absent', async () => {
    const u = await checkForUpdate('1.0.3', 'o/r', async () => ({ tag_name: 'v1.0.5' }))
    expect(u).toEqual({ version: '1.0.5', url: 'https://github.com/o/r/releases/latest' })
  })
})
