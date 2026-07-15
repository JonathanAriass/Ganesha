/** Stringify a cell for substring matching — JSON for objects/arrays, `String` otherwise (covers
 *  BigInt: `String(9007199254740993n)` → '9007199254740993'). Close enough to the grid's cellText
 *  for matching; display formatting stays in the renderer. */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

/** One cell contains the needle (case-insensitive). Empty needle matches everything. */
export function cellMatchesFilter(v: unknown, needle: string): boolean {
  if (needle === '') return true
  return stringify(v).toLowerCase().includes(needle.toLowerCase())
}

/** A row matches when ANY cell contains the needle. Empty needle matches everything. */
export function rowMatchesFilter(row: unknown[], needle: string): boolean {
  if (needle === '') return true
  const n = needle.toLowerCase()
  return row.some((v) => stringify(v).toLowerCase().includes(n))
}

/** Original indexes of the matching rows — used to page the matches and to key edits by each row's
 *  real result index (so a staged edit stays put when the filter is cleared). */
export function filterIndices(rows: unknown[][], needle: string): number[] {
  if (needle === '') return rows.map((_, i) => i)
  const n = needle.toLowerCase()
  const out: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((v) => stringify(v).toLowerCase().includes(n))) out.push(i)
  }
  return out
}
