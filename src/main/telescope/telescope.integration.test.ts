import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { MySqlDriver } from '../drivers/sql/mysql'
import { detectTelescope, listEntries, getEntry, getRelated, getTags, tailSince } from './telescope-service'

/** Spins up a real MySQL, loads a minimal Laravel Telescope schema + fixtures, and exercises the
 *  Telescope service end-to-end through the actual driver (queryRaw / listObjects). Requires Docker. */
describe('Telescope service (integration, requires Docker)', () => {
  let container: StartedMySqlContainer
  const driver = new MySqlDriver('mysql')
  const id = 'tele-itest'

  // batch B1 = a request + its two child queries; B2 = a standalone exception.
  const REQ = '11111111-1111-1111-1111-111111111111'
  const Q1 = '22222222-2222-2222-2222-222222222222'
  const Q2 = '33333333-3333-3333-3333-333333333333'
  const EXC = '44444444-4444-4444-4444-444444444444'
  const B1 = 'b1111111-1111-1111-1111-111111111111'
  const B2 = 'b2222222-2222-2222-2222-222222222222'

  const esc = (s: string): string => s.replace(/'/g, "''")
  async function run(sql: string): Promise<void> {
    await driver.runQuery(id, { kind: 'sql', sql }, { maxRows: 1000, queryId: `s${Math.random()}`, readOnly: false })
  }
  async function insert(uuid: string, batchId: string, type: string, content: unknown, createdAt: string): Promise<void> {
    await run(
      `INSERT INTO telescope_entries (uuid, batch_id, family_hash, should_display_on_index, type, content, created_at)
       VALUES ('${uuid}', '${batchId}', NULL, 1, '${type}', '${esc(JSON.stringify(content))}', '${createdAt}')`
    )
  }

  beforeAll(async () => {
    container = await new MySqlContainer('mysql:8').start()
    await driver.connect({
      id, type: 'mysql', host: container.getHost(), port: container.getPort(),
      username: container.getUsername(), password: container.getUserPassword(), database: container.getDatabase(), ssl: false
    })
    await run(`CREATE TABLE telescope_entries (
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid CHAR(36) NOT NULL UNIQUE,
      batch_id CHAR(36) NOT NULL,
      family_hash VARCHAR(255) NULL,
      should_display_on_index TINYINT(1) NOT NULL DEFAULT 1,
      type VARCHAR(20) NOT NULL,
      content LONGTEXT NOT NULL,
      created_at TIMESTAMP NULL
    )`)
    await run(`CREATE TABLE telescope_entries_tags (entry_uuid CHAR(36) NOT NULL, tag VARCHAR(255) NOT NULL)`)

    // Insert order fixes sequence: REQ=1, Q1=2, Q2=3, EXC=4.
    await insert(REQ, B1, 'request', { method: 'GET', uri: '/api/users', response_status: 200, duration: 12.5, headers: { accept: 'application/json' } }, '2026-07-22 10:00:00')
    await insert(Q1, B1, 'query', { sql: 'select * from users', time: 1.2, connection: 'mysql' }, '2026-07-22 10:00:01')
    await insert(Q2, B1, 'query', { sql: 'select * from roles', time: 0.4, connection: 'mysql' }, '2026-07-22 10:00:02')
    await insert(EXC, B2, 'exception', { class: 'RuntimeException', message: 'boom', trace: [] }, '2026-07-22 10:05:00')
    await run(`INSERT INTO telescope_entries_tags (entry_uuid, tag) VALUES ('${REQ}', 'slow'), ('${EXC}', 'error')`)
  })

  afterAll(async () => {
    await driver.disconnect(id)
    await container?.stop()
  })

  it('detects the Telescope tables', async () => {
    const d = await detectTelescope(driver, id)
    expect(d.installed).toBe(true)
    expect(d.present).toEqual(expect.arrayContaining(['telescope_entries', 'telescope_entries_tags']))
  })

  it('lists a type with keyset pagination (newest first, string sequence)', async () => {
    const p1 = await listEntries(driver, id, { type: 'query', limit: 1 })
    expect(p1.entries.map((e) => e.uuid)).toEqual([Q2]) // seq 3 is newest
    expect(p1.entries[0].sequence).toBe('3')
    expect(typeof p1.entries[0].sequence).toBe('string')
    expect(p1.hasMore).toBe(true)
    expect(p1.nextCursor).toBe('3')
    const p2 = await listEntries(driver, id, { type: 'query', limit: 1, beforeSequence: p1.nextCursor })
    expect(p2.entries.map((e) => e.uuid)).toEqual([Q1]) // seq 2
    expect(p2.entries[0].summary).toMatchObject({ type: 'query', connection: 'mysql' })
  })

  it('fetches one entry with parsed, typed detail content', async () => {
    const d = await getEntry(driver, id, REQ)
    expect(d?.type).toBe('request')
    expect(d?.content).toMatchObject({ type: 'request', uri: '/api/users', method: 'GET', responseStatus: 200, headers: { accept: 'application/json' } })
  })

  it('finds related batch entries (chronological, excluding self)', async () => {
    const rel = await getRelated(driver, id, B1, REQ)
    expect(rel.map((e) => e.uuid)).toEqual([Q1, Q2]) // ASC by sequence
  })

  it('lists distinct tags', async () => {
    expect(await getTags(driver, id)).toEqual(['error', 'slow'])
  })

  it('search spans all types (drops the type filter) and matches content', async () => {
    const p = await listEntries(driver, id, { type: 'request', search: 'roles' })
    // 'roles' only appears in a query entry, even though the requested type was 'request'.
    expect(p.entries.map((e) => e.uuid)).toEqual([Q2])
  })

  it('tailSince returns only newer entries, newest first', async () => {
    const t = await tailSince(driver, id, '2')
    expect(t.map((e) => e.uuid)).toEqual([EXC, Q2]) // seq 4, 3 (DESC)
  })
})
