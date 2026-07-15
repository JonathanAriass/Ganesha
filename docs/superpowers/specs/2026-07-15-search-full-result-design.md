# Search the whole result (Phase A of the search overhaul)

## Problem
The `Filter rows…` box filters client-side over **loaded** rows only (TanStack global filter over
`data: rows`). With load-more, that's just the first 1,000 + whatever's been scrolled in — a match
at row 40,000 is invisible. Filtering must search the **full result**.

## Approach
Move filtering into **main**, over the full cached result (the load-more `ResultCache`, up to the
50k hard cap). Matching is unchanged for Phase A — case-insensitive substring, any column — just
run across every cached row. Results come back **paged** (matches can be many), reusing the
load-more shape. No DB round-trip; the 50k ceiling is the same one load-more already has.

## Matching (main)
- `src/main/result-filter.ts` (pure, tested):
  - `cellMatchesFilter(v, needle)` — `stringify(v).toLowerCase().includes(needle.toLowerCase())`,
    where `stringify` = JSON for objects, `String` otherwise (BigInt-safe).
  - `rowMatchesFilter(row, needle)` — any cell matches (empty needle → true).
  - `filterIndices(rows, needle)` — the original indexes of matching rows (used to page + to keep
    edit-staging keys stable).

## ResultCache (main) — new method
`filterPage(queryId, filter, offset, pageSize): { rows, documents, indices, total, hasMore } | null`
- `filterIndices(cached.rows, filter)` → matched original indexes; `total` = match count.
- Slice indexes `[offset, offset+pageSize)`; `rows`/`documents` gathered at those indexes;
  `indices` = that slice of original indexes; `hasMore = total > offset+pageSize`. Null on cache miss.

## IPC — new channel (feature 1's `query.fetchMore` stays as-is for raw paging)
`query.filter` — `req { queryId, filter, offset }`,
`res { rows: unknown[][]; documents: Record<string,unknown>[] | null; indices: number[]; total: number; hasMore: boolean }`.
Plumbed through `shared/api.ts` + `preload`.

## Store (per tab)
- `filter: string` — active filter text (moves from ResultsPanel local state; '' = off).
- `filterView: { filter: string; rows: unknown[][]; documents: …|null; indices: number[]; total: number; hasMore: boolean } | null`
  — matches loaded so far; null when `filter` is ''.
- Actions: `setFilter(id, filter)` (clears filterView when empty), `applyFilterPage(id, filter, page)`
  (page 1 — ignored if `filter` no longer matches the tab's current filter, avoiding races),
  `appendFilterRows(id, page)` (scroll append), reuse `setLoadingMore`.

## Renderer
- **ResultsPanel**: the `Filter rows…` input drives `setFilter`; a **debounced** (200 ms) call to
  `query.filter(queryId, text, 0)` → `applyFilterPage`. Displayed view = `filterView ?? result`
  (rows, hasMore). Match count in the toolbar: `filter` → "N matches"; export = displayed rows.
  `loadMore` branches: filter active → `query.filter(queryId, filter, filterView.rows.length)` →
  `appendFilterRows`; else the existing raw `query.fetchMore`.
- **ResultsGrid**: display the rows it's handed (already filtered — drop the TanStack global filter;
  keep sorting). New prop `rowIndices: number[] | null` — the original result index per displayed
  row (null = identity). Editing + the inspector key by `rowIndices ? rowIndices[pos] : pos`, so
  staged edits stay stable across filter/clear. `resultKey` includes the filter so selection resets
  when the view changes. Load-more re-enabled while filtering (pages matches).

## Editing while filtered
Kept working: `filterView.indices` carries each match's original result index; the grid stages by
that index (same key the raw view would use), so a staged edit survives clearing the filter.

## Testing
- `result-filter` unit: cell/row matching (substring, case, objects, null, BigInt); `filterIndices`.
- `ResultCache.filterPage` unit: match subset, paging, total/hasMore boundary, documents+indices
  alignment, cache miss → null.
- Store: `setFilter`/`applyFilterPage` (race guard: stale filter ignored)/`appendFilterRows`.

## Non-goals (later phases)
- Operators/regex/per-column (B, C) — Phase A keeps the current substring/any-column matching.
- Highlight (D). Pushing the filter to the DB for >50k tables.
- Date-aware "match the formatted spelling" moves to raw-value matching in main (the display-format
  match was renderer-only); revisit if needed.
