import { describe, it, expect } from 'vitest'
import { relevantTables, tableNameVariants, rankRepoFiles, buildRepoContext } from './repo-context'

describe('relevantTables', () => {
  const known = ['orders', 'order_items', 'users', 'products']
  it('matches known tables named in the message (word-boundary, case-insensitive)', () => {
    expect(relevantTables('Join ORDERS with users please', '', known)).toEqual(['orders', 'users'])
  })
  it('matches tables referenced in the open query text', () => {
    expect(relevantTables('', 'SELECT * FROM order_items WHERE x', known)).toEqual(['order_items'])
  })
  it('ignores tables not in the schema and partial-word hits', () => {
    // "ordering" must not match the table "orders"; "product" (singular) is not a known table
    expect(relevantTables('thinking about ordering a product', '', known)).toEqual([])
  })
  it('de-dupes a table mentioned in both message and query', () => {
    expect(relevantTables('show users', 'select * from users', known)).toEqual(['users'])
  })
})

describe('tableNameVariants', () => {
  it('derives snake/Camel/singular variants (Laravel/Doctrine friendly)', () => {
    expect(new Set(tableNameVariants('users'))).toEqual(new Set(['users', 'user', 'Users', 'User']))
  })
  it('handles multi-word snake_case tables', () => {
    const v = tableNameVariants('order_items')
    expect(v).toContain('order_items')
    expect(v).toContain('OrderItem') // the model class name
    expect(v).toContain('OrderItems')
  })
})

describe('numeric ordering prefixes (e.g. 02_users → Laravel User.php)', () => {
  it('tableNameVariants strips a leading "NN_" prefix so it also matches unprefixed files', () => {
    const v = tableNameVariants('02_users')
    expect(v).toContain('02_users') // keeps the prefixed forms (repos that DO use the prefix still match)
    expect(v).toContain('users') // …and adds the clean forms Laravel/Doctrine actually name files with
    expect(v).toContain('user')
    expect(v).toContain('User')
  })

  it('multi-word prefixed table yields the clean CamelCase model name', () => {
    const v = tableNameVariants('115_okt_card_funding_mandates')
    expect(v).toContain('okt_card_funding_mandates')
    expect(v).toContain('OktCardFundingMandate') // the model class
  })

  it('relevantTables matches a prefixed table when the message names it WITHOUT the prefix', () => {
    expect(
      relevantTables('what can you tell me about users', '', ['02_users', '107_microsoft_users'])
    ).toEqual(['02_users'])
  })

  it('relevantTables still matches the prefixed name verbatim (e.g. from the open query tab)', () => {
    expect(relevantTables('', 'SELECT * FROM `02_users` LIMIT 10', ['02_users'])).toEqual(['02_users'])
  })

  it('rankRepoFiles finds the unprefixed model + migration for a prefixed table', () => {
    const files = [
      'app/Model/User.php',
      'database/migrations/2018_08_13_064755_create_users_table.php',
      'public/index.php',
    ]
    const paths = rankRepoFiles(files, ['02_users']).map((f) => f.path)
    expect(paths[0]).toBe('app/Model/User.php') // name hit + /model/ dir + .php
    expect(paths).toContain('database/migrations/2018_08_13_064755_create_users_table.php')
    expect(paths).not.toContain('public/index.php')
  })
})

describe('rankRepoFiles', () => {
  const files = [
    'app/Models/User.php',
    'database/migrations/2024_01_01_create_users_table.php',
    'src/Http/Controllers/UserController.php',
    'docs/user_guide.md',
    'public/index.php',
    'schema.sql',
  ]
  it('ranks model + migration files for a table above unrelated files', () => {
    const r = rankRepoFiles(files, ['users'])
    const paths = r.map((f) => f.path)
    expect(paths[0]).toBe('app/Models/User.php') // filename hit + Models dir + .php
    expect(paths).toContain('database/migrations/2024_01_01_create_users_table.php')
    expect(paths).not.toContain('public/index.php') // no table-name hit
  })
})

describe('buildRepoContext', () => {
  const reader = (p: string): string | null =>
    p === 'app/Models/User.php' ? "<?php\nclass User extends Model {\n  protected $fillable = ['email','name'];\n}" : null

  it('reads the top files, formats labeled snippets, reports used files, respects the budget', () => {
    const ranked = rankRepoFiles(['app/Models/User.php'], ['users'])
    const out = buildRepoContext({ tables: ['users'], ranked, readFile: reader, budget: 4000 })
    expect(out.used.map((u) => u.path)).toEqual(['app/Models/User.php'])
    expect(out.text).toContain('app/Models/User.php')
    expect(out.text).toContain('fillable')
  })
  it('reports each used file with the table that pulled it in and the injected snippet', () => {
    const ranked = rankRepoFiles(['app/Models/User.php'], ['users'])
    const out = buildRepoContext({ tables: ['users'], ranked, readFile: reader, budget: 4000 })
    expect(out.used[0]).toMatchObject({ path: 'app/Models/User.php', table: 'users' })
    expect(out.used[0].snippet).toContain('fillable') // the exact text the model saw
  })
  it('returns empty when no tables are relevant', () => {
    expect(buildRepoContext({ tables: [], ranked: [], readFile: reader, budget: 4000 })).toEqual({
      text: '',
      used: [],
    })
  })
})
