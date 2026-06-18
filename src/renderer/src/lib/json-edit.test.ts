import { describe, it, expect } from 'vitest'
import { jsonEditTarget, applyPendingEdits } from './json-edit'
import { editKey } from './doc-path'

describe('jsonEditTarget', () => {
  it('maps a top-level edit (parentPath = [rowIndex]) to row + field path', () => {
    expect(jsonEditTarget(['0'], 'name')).toEqual({ rowIndex: 0, path: 'name' })
  })
  it('maps a nested edit to a dotted path within the document', () => {
    expect(jsonEditTarget(['2', 'address'], 'city')).toEqual({ rowIndex: 2, path: 'address.city' })
  })
  it('maps an array-element edit', () => {
    expect(jsonEditTarget(['0', 'tags'], 1)).toEqual({ rowIndex: 0, path: 'tags.1' })
  })
  it('returns null for an empty parent path (editing the array root)', () => {
    expect(jsonEditTarget([], 0)).toBeNull()
  })
  it('returns null when the row index is not an integer', () => {
    expect(jsonEditTarget(['x'], 'name')).toBeNull()
  })
  it('returns null for a $-segmented path (inside an EJSON wrapper — unsafe to $set)', () => {
    expect(jsonEditTarget(['0', 'when'], '$date')).toBeNull()
    expect(jsonEditTarget(['0', '_id'], '$oid')).toBeNull()
  })
})

describe('applyPendingEdits', () => {
  const docs = [
    { _id: 1, name: 'a', addr: { city: 'Paris' } },
    { _id: 2, name: 'b' }
  ]
  it('returns the same array reference when there are no edits', () => {
    expect(applyPendingEdits(docs, {})).toBe(docs)
  })
  it('applies staged edits by path, immutably (untouched docs keep their reference)', () => {
    const edits = { [editKey(0, 'name')]: 'AA', [editKey(0, 'addr.city')]: 'Lyon' }
    const next = applyPendingEdits(docs, edits)
    expect(next[0]).toEqual({ _id: 1, name: 'AA', addr: { city: 'Lyon' } })
    expect(next[1]).toBe(docs[1]) // untouched doc shared
    expect(docs[0]).toEqual({ _id: 1, name: 'a', addr: { city: 'Paris' } }) // original unchanged
  })
})
