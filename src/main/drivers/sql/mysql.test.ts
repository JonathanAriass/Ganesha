import { describe, it, expect } from 'vitest'
import { MySqlDriver } from './mysql'

describe('MySqlDriver', () => {
  it('defaults to mysql and accepts mariadb as its type', () => {
    expect(new MySqlDriver().type).toBe('mysql')
    expect(new MySqlDriver('mariadb').type).toBe('mariadb')
  })

  it('rejects a non-SQL request', async () => {
    await expect(
      new MySqlDriver().runQuery('x', { kind: 'mongo', command: { op: 'find', collection: 'c' } }, {
        maxRows: 10,
        queryId: 'q',
        readOnly: false
      })
    ).rejects.toThrow(/only sql/i)
  })
})
