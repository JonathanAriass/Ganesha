/**
 * Decide whether the grid should fetch the next page, from the virtualizer's last rendered
 * row index. Fires when the user has scrolled within `threshold` rows of the end AND there's
 * more to load AND a load isn't already in flight (so a burst of scroll frames triggers at
 * most one fetch until it resolves).
 *
 * @param lastIndex  index of the last row the virtualizer has rendered (-1 if none)
 * @param loaded     rows currently loaded (the virtualized row count)
 */
export function shouldLoadMore(
  lastIndex: number,
  loaded: number,
  hasMore: boolean,
  loadingMore: boolean,
  threshold = 20,
): boolean {
  if (!hasMore || loadingMore) return false
  if (lastIndex < 0 || loaded === 0) return false
  return lastIndex >= loaded - 1 - threshold
}
