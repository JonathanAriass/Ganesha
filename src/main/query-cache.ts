import { compileQuery, highlightTerms } from './result-filter'
import type { FilterQuery } from '../shared/query'

/** A page of a cached result: the slice at the requested offset plus whether rows remain
 *  past it (so the renderer knows to keep offering "load more"). */
export interface ResultPage {
  rows: unknown[][]
  documents: Record<string, unknown>[] | null
  hasMore: boolean
}

/** A page of the FILTERED result: like ResultPage, plus each row's original result index (so edits
 *  key by the real index) and the total match count (for the "N matches" label). */
export interface FilterPage {
  rows: unknown[][]
  documents: Record<string, unknown>[] | null
  indices: number[]
  total: number
  hasMore: boolean
  /** True when the query was `regex` mode with an invalid pattern — the UI says so, total is 0. */
  invalid: boolean
  /** The positive global terms to highlight in matched cells (or [regexSource] in regex mode). */
  highlight: string[]
}

/** The full (up to the hard cap) result set retained so the renderer can page through it
 *  without re-running the query. */
export interface CachedResult {
  rows: unknown[][]
  documents: Record<string, unknown>[] | null
  /** Column names, so `colname op value` box syntax can resolve a column to its index. */
  columns: string[]
}

/**
 * Bounded LRU of full result sets, keyed by queryId, so the grid can load more rows on
 * scroll without a re-query. Memory is bounded by `maxEntries` — the least-recently-used
 * result is evicted on insert, and a `page()` miss (evicted / unknown id) tells the renderer
 * to stop paging. A JS `Map` preserves insertion order, which is the LRU order here.
 */
export class ResultCache {
  private readonly map = new Map<string, CachedResult>()

  constructor(private readonly maxEntries = 6) {}

  /** Retain a result (most-recently-used); evict the oldest beyond the cap. */
  store(queryId: string, result: CachedResult): void {
    this.map.delete(queryId) // re-inserting moves it to the MRU (last) position
    this.map.set(queryId, result)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string
      this.map.delete(oldest)
    }
  }

  /** The `pageSize` slice at `offset`, and whether rows remain past it. Returns null when the
   *  id isn't cached (evicted or unknown) — the renderer then stops paging. Bumps LRU recency. */
  page(queryId: string, offset: number, pageSize: number): ResultPage | null {
    const cached = this.map.get(queryId)
    if (!cached) return null
    this.map.delete(queryId) // bump to MRU
    this.map.set(queryId, cached)
    const end = offset + pageSize
    return {
      rows: cached.rows.slice(offset, end),
      documents: cached.documents ? cached.documents.slice(offset, end) : null,
      hasMore: cached.rows.length > end,
    }
  }

  /** A page of the rows matching `filter` (case-insensitive substring, any column) across the
   *  WHOLE cached result — the fix for filtering only loaded rows. `indices` are the matches'
   *  original result indexes; `total` is the full match count. Null on cache miss. Bumps LRU. */
  filterPage(queryId: string, query: FilterQuery, offset: number, pageSize: number): FilterPage | null {
    const cached = this.map.get(queryId)
    if (!cached) return null
    this.map.delete(queryId) // bump to MRU
    this.map.set(queryId, cached)
    const compiled = compileQuery(query, cached.columns)
    const highlight = highlightTerms(query, cached.columns)
    if (compiled.invalid) return { rows: [], documents: null, indices: [], total: 0, hasMore: false, invalid: true, highlight }
    const matched: number[] = []
    for (let i = 0; i < cached.rows.length; i++) if (compiled.match(cached.rows[i])) matched.push(i)
    const slice = matched.slice(offset, offset + pageSize)
    return {
      rows: slice.map((i) => cached.rows[i]),
      documents: cached.documents ? slice.map((i) => cached.documents![i]) : null,
      indices: slice,
      total: matched.length,
      hasMore: matched.length > offset + pageSize,
      invalid: false,
      highlight,
    }
  }

  release(queryId: string): void {
    this.map.delete(queryId)
  }

  /** Test/introspection only. */
  size(): number {
    return this.map.size
  }
}
