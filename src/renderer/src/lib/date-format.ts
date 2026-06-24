import { cellText } from './grid-text'

/** Friendly DISPLAY formatting for SQL date/time/timestamp columns in the results grid.
 *  Display-only: copy, export, editing, and the hover tooltip keep the raw stored value.
 *  Pure — no `Date`/timezone conversion, so a stored wall-clock value is shown exactly as
 *  stored (just reordered to day-first); anything unexpected falls back to the raw text. */

export type DateKind = 'date' | 'time' | 'datetime'
export type SqlDialect = 'postgres' | 'mysql'

// Postgres type OIDs — the result column `dataType` is `String(field.dataTypeID)`.
// 1186 (interval) is deliberately absent: it's a duration, not a calendar value.
const PG_KIND: Record<string, DateKind> = {
  '1082': 'date', // date
  '1083': 'time', // time
  '1266': 'time', // timetz
  '1114': 'datetime', // timestamp
  '1184': 'datetime', // timestamptz
}

// mysql2 column type codes — the result column `dataType` is `String(field.type)`.
// 13 (YEAR) is deliberately absent: it's a bare year number, not a date.
const MYSQL_KIND: Record<string, DateKind> = {
  '10': 'date', // DATE
  '14': 'date', // NEWDATE
  '11': 'time', // TIME
  '7': 'datetime', // TIMESTAMP
  '12': 'datetime', // DATETIME
}

/** The date kind of a result column from its driver type code + dialect; null = not a
 *  date/time column we reformat. Dialects: mysql AND mariadb share the mysql codes. */
export function dateColumnKind(dataType: string | null, dialect: SqlDialect): DateKind | null {
  if (dataType === null) return null
  return (dialect === 'postgres' ? PG_KIND : MYSQL_KIND)[dataType] ?? null
}

// Anchored at the start: the value begins with the date/time. Anchoring also stops a
// 3-digit mysql TIME like `838:59:59` from being mis-parsed as `38:59:59`.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})/
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/

/** Reformat a raw SQL date/time string to day-first `DD-MM-YYYY HH:MM:SS` (or the date-/
 *  time-only slice for those kinds), dropping fractional seconds and any tz offset. A value
 *  that isn't a string, or doesn't match the kind's shape, returns its raw `cellText`. */
export function formatDbDate(value: unknown, kind: DateKind): string {
  if (typeof value !== 'string') return cellText(value)
  if (kind === 'date') {
    const m = DATE_RE.exec(value)
    return m ? `${m[3]}-${m[2]}-${m[1]}` : cellText(value)
  }
  if (kind === 'time') {
    const m = TIME_RE.exec(value)
    return m ? `${m[1]}:${m[2]}:${m[3]}` : cellText(value)
  }
  const m = DATETIME_RE.exec(value)
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}` : cellText(value)
}

/** The text the grid SHOWS for a cell: formatted when its column is a date kind, else the
 *  raw `cellText`. (Copy/export/edit still use the raw value.) */
export function displayCellText(value: unknown, kind: DateKind | null): string {
  return kind ? formatDbDate(value, kind) : cellText(value)
}

/** Filter match accepting EITHER the raw value or its formatted display, so the user can
 *  search what they see (`24-06-2024`) or the stored form (`2024-06-24`). */
export function cellMatchesDateAware(value: unknown, kind: DateKind | null, filter: string): boolean {
  const f = filter.toLowerCase()
  if (cellText(value).toLowerCase().includes(f)) return true
  return kind !== null && formatDbDate(value, kind).toLowerCase().includes(f)
}
