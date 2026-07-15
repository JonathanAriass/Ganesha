/** A page of a cached result: the slice at the requested offset plus whether rows remain
 *  past it (so the renderer knows to keep offering "load more"). */
export interface ResultPage {
  rows: unknown[][]
  documents: Record<string, unknown>[] | null
  hasMore: boolean
}

/** The full (up to the hard cap) result set retained so the renderer can page through it
 *  without re-running the query. */
export interface CachedResult {
  rows: unknown[][]
  documents: Record<string, unknown>[] | null
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

  release(queryId: string): void {
    this.map.delete(queryId)
  }

  /** Test/introspection only. */
  size(): number {
    return this.map.size
  }
}
