import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './system-prompt'

describe('buildSystemPrompt', () => {
  it('with no repo, returns intro + schema only (no STEP scaffolding)', () => {
    const p = buildSystemPrompt('mysql', 'Database dialect: mysql.\nTables:\nusers(id int)', '')
    expect(p).toContain('users(id int)')
    expect(p).not.toContain('STEP 2')
    expect(p).toContain('```sql')
  })

  it('reads the database tables BEFORE the repo, and labels both steps', () => {
    const p = buildSystemPrompt('mysql', 'SCHEMA_HERE', 'REPO_HERE', ['116_okt_card_company_config'])
    expect(p.indexOf('STEP 1')).toBeLessThan(p.indexOf('STEP 2'))
    expect(p.indexOf('SCHEMA_HERE')).toBeLessThan(p.indexOf('REPO_HERE'))
  })

  it('names the focus tables in the precedence rule placed AFTER the repo (recency)', () => {
    const p = buildSystemPrompt('mysql', 'SCHEMA', 'REPO', ['116_okt_card_company_config'])
    expect(p.indexOf('116_okt_card_company_config')).toBeGreaterThan(p.indexOf('REPO'))
    expect(p).toMatch(/relevant table\(s\) are exactly:.*116_okt_card_company_config/i)
    expect(p).toMatch(/not in STEP 1/i)
  })

  it('uses js fences for mongodb', () => {
    expect(buildSystemPrompt('mongodb', 'S', '')).toContain('```js')
  })

  it('nudges SQL toward the fewest joins (filter on a FK column rather than joining to reach it)', () => {
    const p = buildSystemPrompt('mysql', 'S', '')
    expect(p).toMatch(/fewest joins/i)
    expect(p).toMatch(/filter on that column directly/i)
  })
})
