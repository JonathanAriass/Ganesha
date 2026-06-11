import { describe, it, expect } from 'vitest'
import { defaultSnippetName } from './snippet-name'

describe('defaultSnippetName', () => {
  it('uses the first line of plain SQL', () => {
    expect(defaultSnippetName('select * from users\nlimit 10')).toBe('select * from users')
  })

  it('strips a leading -- title comment marker', () => {
    expect(defaultSnippetName('-- Top customers\nselect 1')).toBe('Top customers')
  })

  it('strips // and # markers', () => {
    expect(defaultSnippetName('// count orders\ndb.orders.countDocuments()')).toBe('count orders')
    expect(defaultSnippetName('# weekly report\nselect 1')).toBe('weekly report')
  })

  it('strips a /* boxed */ comment', () => {
    expect(defaultSnippetName('/* boxed title */\nselect 1')).toBe('boxed title')
  })

  it('uses the title from a multi-line boxed comment continuation', () => {
    expect(defaultSnippetName('/*\n * Count by region\n */\nselect 1')).toBe('Count by region')
  })

  it('drops a trailing inline comment', () => {
    expect(defaultSnippetName('select 1 /* count */')).toBe('select 1')
  })

  it('skips blank lines and bare comment markers', () => {
    expect(defaultSnippetName('\n  \n--\nselect 2')).toBe('select 2')
  })

  it('truncates to 60 characters', () => {
    const long = 'x'.repeat(80)
    expect(defaultSnippetName(long)).toBe('x'.repeat(60))
  })

  it('returns empty for empty or comment-only-marker input', () => {
    expect(defaultSnippetName('')).toBe('')
    expect(defaultSnippetName('   \n--\n')).toBe('')
  })
})
