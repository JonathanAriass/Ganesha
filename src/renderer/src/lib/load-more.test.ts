import { describe, it, expect } from 'vitest'
import { shouldLoadMore } from './load-more'

describe('shouldLoadMore', () => {
  it('fires when the last rendered row is within the threshold of the end', () => {
    // 1000 loaded, threshold 20 → fire once index reaches 979
    expect(shouldLoadMore(979, 1000, true, false)).toBe(true)
    expect(shouldLoadMore(999, 1000, true, false)).toBe(true)
  })

  it('does not fire mid-scroll (far from the end)', () => {
    expect(shouldLoadMore(500, 1000, true, false)).toBe(false)
  })

  it('never fires when there is nothing more to load', () => {
    expect(shouldLoadMore(999, 1000, false, false)).toBe(false)
  })

  it('never fires while a load is already in flight', () => {
    expect(shouldLoadMore(999, 1000, true, true)).toBe(false)
  })

  it('is inert before any rows render', () => {
    expect(shouldLoadMore(-1, 0, true, false)).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(shouldLoadMore(994, 1000, true, false, 5)).toBe(true)
    expect(shouldLoadMore(993, 1000, true, false, 5)).toBe(false)
  })
})
