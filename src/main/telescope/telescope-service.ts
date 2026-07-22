// Read-only orchestration over the Laravel Telescope tables. Runs the parameterized SELECTs from
// queries.ts through a driver's queryRaw (object rows), then maps DB rows → typed payloads via
// parse.ts. Kept behind a minimal TelescopeReader interface so it's unit-testable with a fake and
// engine-agnostic (only the SQL drivers implement queryRaw; Mongo has no Telescope tables).

import type {
  TelescopeEntry, TelescopeEntryDetail, TelescopePage, TelescopeFilter, TelescopeDetectResult
} from '../../shared/telescope'
import { parseEntrySummary, parseEntryDetail } from './parse'
import {
  buildEntriesQuery, buildEntryQuery, buildRelatedQuery, buildTagsQuery, buildTailQuery, DEFAULT_LIST_LIMIT
} from './queries'

/** The slice of a DatabaseDriver the Telescope service needs (DatabaseDriver satisfies it). */
export interface TelescopeReader {
  listObjects(id: string): Promise<{ name: string }[]>
  queryRaw?(id: string, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}

/** Laravel Telescope tables we care about (monitoring is detected but never queried). */
const WANTED = ['telescope_entries', 'telescope_entries_tags', 'telescope_monitoring']

/** Does this connection have Laravel Telescope installed? Reuses listObjects (SSH-tunnel-aware,
 *  works for every engine — a Mongo connection simply won't have a telescope_entries "object"). */
export async function detectTelescope(reader: TelescopeReader, id: string): Promise<TelescopeDetectResult> {
  const names = new Set((await reader.listObjects(id)).map((o) => o.name))
  const present = WANTED.filter((n) => names.has(n))
  return { installed: present.includes('telescope_entries'), present }
}

function requireSql(reader: TelescopeReader): NonNullable<TelescopeReader['queryRaw']> {
  if (!reader.queryRaw) throw new Error('The Telescope inspector requires a SQL (MySQL/MariaDB) connection.')
  return reader.queryRaw.bind(reader)
}

/** telescope_entries.content is LONGTEXT holding JSON on MySQL (a string → JSON.parse); on engines
 *  that expose it as jsonb it arrives pre-parsed. Malformed content degrades to an empty object. */
function parseContent(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return raw ?? {}
}

const s = (v: unknown): string => (v == null ? '' : String(v))
const sOrNull = (v: unknown): string | null => (v == null ? null : String(v))

function toEntry(row: Record<string, unknown>): TelescopeEntry {
  const type = s(row.type)
  return {
    sequence: s(row.sequence), // BIGINT — keep as an exact string
    uuid: s(row.uuid),
    batchId: s(row.batch_id),
    familyHash: sOrNull(row.family_hash),
    type,
    createdAt: sOrNull(row.created_at),
    summary: parseEntrySummary(type, parseContent(row.content))
  }
}

function toDetail(row: Record<string, unknown>): TelescopeEntryDetail {
  const type = s(row.type)
  return {
    sequence: s(row.sequence),
    uuid: s(row.uuid),
    batchId: s(row.batch_id),
    familyHash: sOrNull(row.family_hash),
    type,
    createdAt: sOrNull(row.created_at),
    content: parseEntryDetail(type, parseContent(row.content))
  }
}

/** One keyset page of entries for the given filter. */
export async function listEntries(reader: TelescopeReader, id: string, filter: TelescopeFilter): Promise<TelescopePage> {
  const { sql, params } = buildEntriesQuery(filter)
  const rows = await requireSql(reader)(id, sql, params)
  const entries = rows.map(toEntry)
  const limit = filter.limit ?? DEFAULT_LIST_LIMIT
  return {
    entries,
    hasMore: entries.length === limit,
    nextCursor: entries.length ? entries[entries.length - 1].sequence : null
  }
}

/** One entry's full detail, or null if it's gone. */
export async function getEntry(reader: TelescopeReader, id: string, uuid: string): Promise<TelescopeEntryDetail | null> {
  const { sql, params } = buildEntryQuery(uuid)
  const rows = await requireSql(reader)(id, sql, params)
  return rows.length ? toDetail(rows[0]) : null
}

/** Sibling entries in the same batch (chronological), optionally excluding one uuid. */
export async function getRelated(reader: TelescopeReader, id: string, batchId: string, excludeUuid?: string): Promise<TelescopeEntry[]> {
  const { sql, params } = buildRelatedQuery(batchId, excludeUuid)
  const rows = await requireSql(reader)(id, sql, params)
  return rows.map(toEntry)
}

/** Distinct tags across all entries. */
export async function getTags(reader: TelescopeReader, id: string): Promise<string[]> {
  const { sql, params } = buildTagsQuery()
  const rows = await requireSql(reader)(id, sql, params)
  return rows.map((r) => s(r.tag))
}

/** Entries newer than `lastSequence` (DESC, newest first) — the live-tail primitive. */
export async function tailSince(reader: TelescopeReader, id: string, lastSequence: string): Promise<TelescopeEntry[]> {
  const { sql, params } = buildTailQuery(lastSequence)
  const rows = await requireSql(reader)(id, sql, params)
  return rows.map(toEntry)
}
