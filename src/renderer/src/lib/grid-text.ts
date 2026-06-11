/** Render a cell value the way the grid does (objects stringify, null/undefined blank). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** One cell vs the filter — the single matching rule shared by grid and export. */
export function cellMatchesFilter(v: unknown, filter: string): boolean {
  return cellText(v).toLowerCase().includes(filter.toLowerCase())
}

/** A row passes when any cell matches (TanStack global-filter semantics). */
export function rowMatchesFilter(row: unknown[], filter: string): boolean {
  return !filter || row.some((v) => cellMatchesFilter(v, filter))
}
