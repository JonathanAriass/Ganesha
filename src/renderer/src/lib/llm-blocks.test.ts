import { describe, it, expect } from 'vitest'
import { extractCodeBlocks } from './llm-blocks'

describe('extractCodeBlocks', () => {
  it('pulls a fenced sql block with its language', () => {
    const md = 'Here:\n```sql\nSELECT 1;\n```\nDone.'
    expect(extractCodeBlocks(md)).toEqual([{ lang: 'sql', code: 'SELECT 1;' }])
  })
  it('returns multiple blocks in order, defaulting a missing language to ""', () => {
    const md = '```js\ndb.users.find({})\n```\ntext\n```\nplain\n```'
    expect(extractCodeBlocks(md)).toEqual([
      { lang: 'js', code: 'db.users.find({})' },
      { lang: '', code: 'plain' }
    ])
  })
  it('returns [] when there are no fences', () => {
    expect(extractCodeBlocks('just prose')).toEqual([])
  })
  it('ignores an unterminated fence', () => {
    expect(extractCodeBlocks('```sql\nSELECT 1')).toEqual([])
  })
})
