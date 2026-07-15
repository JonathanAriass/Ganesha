# Results: load more on scroll (cache & auto-load)

## Problem
A query result is capped at 1,000 rows (`DEFAULT_MAX_ROWS`, `query-service.ts`). Larger
results are silently truncated; there's no way to see rows past the first 1,000.

## Approach — cache & window (chosen over streaming cursors)
Run the query once, keep the full fetched result **in main** (up to a hard cap), and serve
1,000-row pages to the renderer. The grid auto-loads the next page when you scroll near the
bottom. No re-query, no SQL rewriting; works for any query and for Mongo.

- **PAGE_SIZE = 1000** — rows per page (first paint + each load-more batch).
- **HARD_CAP = 50000** — most rows main will retain per result. Beyond it, `truncated` stays
  true (honest marker), same semantics as today just at a higher ceiling.

## Data flow
1. `runUserQuery` calls the driver with `maxRows: HARD_CAP` (drivers already cap+set
   `truncated`). It caches the **full** result (columns, all rows, documents, editable) in a
   main-side `ResultCache` keyed by `queryId`, and returns only the first `PAGE_SIZE` rows plus
   `hasMore` (cached rows > returned) to the renderer.
2. New IPC **`query.fetchMore`** `{ queryId, offset }` → returns `{ rows, documents?, hasMore }`
   = the `PAGE_SIZE` slice of the cached result at `offset`.
3. Renderer appends the batch to `tab.result.rows` (+ `documents` for Mongo) and updates
   `hasMore`.

## ResultCache (main)
- `Map<queryId, CachedResult>`; `CachedResult = { columns, rows, documents, editable, truncated }`.
- LRU-bounded to **6** entries (evict least-recently-used on insert) — bounds memory; a very old
  result loses load-more (re-run to page again). `get(queryId)` bumps recency.
- `release(queryId)` drops one entry. Called by the renderer when a tab starts a new run or closes.

## Shape changes
- `QueryResult` (shared): add `hasMore?: boolean` (page 1 sets it; absent = false).
- New IPC channel `query.fetchMore`: `req { queryId: string; offset: number }`,
  `res { rows: unknown[][]; documents: unknown[] | null; hasMore: boolean }`.
- New IPC channel `query.release`: `req { queryId: string }`, `res null`.
- `preload` + `shared/api.ts`: `query.fetchMore(queryId, offset)`, `query.release(queryId)`.

## Store / renderer
- `QueryTabData`: add `resultQueryId: string | null` (the queryId behind the current result, kept
  so fetchMore can reference it — `finishRun` currently nulls `queryId`), `hasMore: boolean`,
  `loadingMore: boolean`.
- `finishRun(id, { result, queryId })`: store `resultQueryId = queryId`, `hasMore = result.hasMore`.
- New action `appendRows(id, { rows, documents, hasMore })`: concat onto `tab.result.rows`/
  `documents`, set `hasMore`, clear `loadingMore`. Guarded (result must still exist).
- New action `startLoadMore(id)` / usage: set `loadingMore` true before the IPC.
- On a fresh `startRun` and on tab close: call `window.api.query.release(prevResultQueryId)` and
  drop `resultQueryId`.
- `ResultsGrid`: a pure `shouldLoadMore(range, rowCount, hasMore, loadingMore)` helper
  (`lib/load-more.ts`) decides from the virtualizer's rendered range whether we're within a
  screenful of the end. When true, call an `onLoadMore` prop. A bottom "loading more…" row shows
  while `loadingMore`.

## Editing interaction
Appended rows keep contiguous absolute indexes (page 2 = 1000..1999), so `editable` + the
rowIndex-keyed edit staging are unaffected. The single-table+PK edit path is untouched.

## Row-count label
`rowCountLabel` / the truncation chip read the accumulated count + `hasMore`/`truncated`:
"showing N (more…)" while pageable; "N rows" when fully loaded; the truncated chip only at the
hard cap. Pure helper, unit-tested.

## Testing
- `ResultCache` unit: insert/get/LRU-evict/release; slice at offset; hasMore boundary.
- `shouldLoadMore` unit: near-end true, mid-scroll false, no-op when !hasMore or loadingMore.
- `appendRows` store test: appends rows+documents, updates hasMore, no-op if result cleared.
- Row-count label unit for the paged states.
- Driver/query-service: `runUserQuery` returns page 1 + hasMore and the cache holds the rest.

## Non-goals (v1)
- Row filter/sort operate on already-loaded rows only.
- No SQL LIMIT injection / server cursor (drivers still fetch then slice, now at HARD_CAP).
