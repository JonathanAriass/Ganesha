// Parameterized, read-only SQL against the Laravel Telescope tables (MySQL/MariaDB), ported from
// telescope2's src-tauri/src/db/queries.rs. Every builder returns { sql, params } so the exact
// bind order can be unit-tested. `type` is always backtick-quoted (reserved word). Pagination is
// keyset on `sequence` DESC (never OFFSET). Cursors are bound as strings to preserve BIGINT fidelity.

import type { TelescopeFilter } from '../../shared/telescope'

export const DEFAULT_LIST_LIMIT = 50
export const TAIL_LIMIT = 100
export const RELATED_LIMIT = 101 // 100 siblings + 1 to detect overflow
export const SEARCH_WINDOW = 10000 // LIKE scans only the most recent ~N entries (perf guard)

/** The 7 metadata columns every entry query selects (unqualified). */
const COLS = 'sequence, uuid, batch_id, family_hash, `type`, content, created_at'
/** Same columns, aliased to `e` for the search/tag JOIN builder. */
const COLS_E = 'e.sequence, e.uuid, e.batch_id, e.family_hash, e.`type`, e.content, e.created_at'

export interface Sql { sql: string; params: unknown[] }

/**
 * List entries for the current filter. Mirrors telescope2's routing:
 *   - search OR tag present → the dynamic builder (JOIN + LIKE), where a text search DROPS the
 *     type filter (searches all types) and adds the recent-window perf guard.
 *   - otherwise → the plain type-scoped list.
 * Bind order for the dynamic path (load-bearing): tag, search, [type], cursor, limit.
 */
export function buildEntriesQuery(filter: TelescopeFilter): Sql {
  const limit = filter.limit ?? DEFAULT_LIST_LIMIT
  const search = filter.search?.trim() ?? ''
  const tag = filter.tag?.trim() ?? ''
  const hasSearch = search.length > 0
  const hasTag = tag.length > 0

  if (hasSearch || hasTag) {
    const params: unknown[] = []
    const where: string[] = ['e.should_display_on_index = 1']
    const from = hasTag
      ? 'telescope_entries e INNER JOIN telescope_entries_tags t ON t.entry_uuid = e.uuid'
      : 'telescope_entries e'
    const select = hasTag ? `SELECT DISTINCT ${COLS_E}` : `SELECT ${COLS_E}`

    if (hasTag) { where.push('t.tag = ?'); params.push(tag) }
    if (hasSearch) {
      where.push("e.content LIKE CONCAT('%', ?, '%')"); params.push(search)
      where.push(`e.sequence > (SELECT MAX(sequence) - ${SEARCH_WINDOW} FROM telescope_entries)`)
    }
    // A text search searches ALL types (type filter dropped); a tag-only filter keeps the type.
    if (!hasSearch && filter.type) { where.push('e.`type` = ?'); params.push(filter.type) }
    if (filter.beforeSequence) { where.push('e.sequence < ?'); params.push(filter.beforeSequence) }
    params.push(limit)
    return { sql: `${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY e.sequence DESC LIMIT ?`, params }
  }

  const params: unknown[] = []
  const where: string[] = ['should_display_on_index = 1']
  if (filter.type) { where.push('`type` = ?'); params.push(filter.type) }
  if (filter.beforeSequence) { where.push('sequence < ?'); params.push(filter.beforeSequence) }
  params.push(limit)
  return { sql: `SELECT ${COLS} FROM telescope_entries WHERE ${where.join(' AND ')} ORDER BY sequence DESC LIMIT ?`, params }
}

/** A single entry by uuid (detail pane). */
export function buildEntryQuery(uuid: string): Sql {
  return { sql: `SELECT ${COLS} FROM telescope_entries WHERE uuid = ?`, params: [uuid] }
}

/** Sibling entries in the same batch (a request's child queries/logs/etc.), chronological.
 *  Deliberately omits should_display_on_index so sub-entries appear. */
export function buildRelatedQuery(batchId: string, excludeUuid?: string, limit = RELATED_LIMIT): Sql {
  if (excludeUuid) {
    return { sql: `SELECT ${COLS} FROM telescope_entries WHERE batch_id = ? AND uuid != ? ORDER BY sequence ASC LIMIT ?`, params: [batchId, excludeUuid, limit] }
  }
  return { sql: `SELECT ${COLS} FROM telescope_entries WHERE batch_id = ? ORDER BY sequence ASC LIMIT ?`, params: [batchId, limit] }
}

/** Distinct tag list for the tag filter. */
export function buildTagsQuery(): Sql {
  return { sql: 'SELECT DISTINCT tag FROM telescope_entries_tags ORDER BY tag ASC', params: [] }
}

/** Entries newer than a sequence cursor (live tail). Called with '0' at startup to read the max. */
export function buildTailQuery(lastSequence: string, limit = TAIL_LIMIT): Sql {
  return { sql: `SELECT ${COLS} FROM telescope_entries WHERE should_display_on_index = 1 AND sequence > ? ORDER BY sequence DESC LIMIT ?`, params: [lastSequence, limit] }
}
