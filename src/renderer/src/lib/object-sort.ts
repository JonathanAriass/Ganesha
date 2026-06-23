import type { DbObject } from '@shared/schema'

/** Sidebar table ordering. `number` = natural/alphanumeric (so a `NN_` migration prefix orders
 *  1→100); `name` = alphabetical by the table name with that prefix ignored; `full` = plain text
 *  order of the whole name (prefix leads, so `10_` lands after `100_`). */
export type SortMode = 'number' | 'name' | 'full'

const MODES: readonly SortMode[] = ['number', 'name', 'full']
const STORAGE_KEY = 'object-sort'
const DEFAULT_MODE: SortMode = 'number'

/** Strip a leading ordering prefix like `02_` / `115_` so the by-name mode sorts on the meaningful
 *  part. Names without such a prefix are unchanged. */
function stripPrefix(name: string): string {
  return name.replace(/^\d+[_-]/, '')
}

/** Split into runs of digits (compared as numbers) and non-digits (compared as lowercased text), so
 *  `10` sorts after `2` and before `100` — natural/alphanumeric order. */
function chunks(s: string): Array<string | number> {
  const out: Array<string | number> = []
  const re = /\d+|\D+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    out.push(/^\d/.test(m[0]) ? parseInt(m[0], 10) : m[0].toLowerCase())
  }
  return out
}

function compareNatural(a: string, b: string): number {
  const ca = chunks(a)
  const cb = chunks(b)
  const n = Math.min(ca.length, cb.length)
  for (let i = 0; i < n; i++) {
    const x = ca[i]
    const y = cb[i]
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else if (typeof x === 'number') {
      return -1 // a number chunk sorts before a text chunk (so prefixed tables lead)
    } else if (typeof y === 'number') {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return ca.length - cb.length
}

/** Plain case-insensitive text order (NOT number-aware): `100_` sorts before `10_`. */
function compareText(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  return al < bl ? -1 : al > bl ? 1 : 0
}

/** Sort a COPY of `objects` by `mode`, grouping by schema first (so postgres schemas / mongo
 *  databases stay together) and ordering within each group. Never mutates the input. */
export function sortObjects(objects: DbObject[], mode: SortMode): DbObject[] {
  const byName =
    mode === 'full'
      ? compareText
      : mode === 'name'
        ? (a: string, b: string): number => compareNatural(stripPrefix(a), stripPrefix(b)) || compareNatural(a, b)
        : compareNatural // 'number'
  return objects.slice().sort((a, b) => compareText(a.schema ?? '', b.schema ?? '') || byName(a.name, b.name))
}

function isSortMode(v: unknown): v is SortMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

/** Persisted globally — a UI preference, like the editor split — so it survives restarts and
 *  connection switches. The storage seam keeps it unit-testable under Node. */
export function loadSortMode(storage: Storage = localStorage): SortMode {
  try {
    const v = storage.getItem(STORAGE_KEY)
    return isSortMode(v) ? v : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

export function saveSortMode(mode: SortMode, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, mode)
  } catch {
    // ignore (private mode / quota exceeded)
  }
}
