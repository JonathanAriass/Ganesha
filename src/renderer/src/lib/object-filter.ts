import type { DbObject } from '@shared/schema'

/** Case-insensitive substring ("contains") match. Returns the matched CODE-POINT
 *  indices in `target` (the contiguous run, for highlighting), or null if `query`
 *  does not occur in `target`. An empty query returns [] (matches everything).
 *
 *  Works in code-point space (`[...s]`), not UTF-16 units, so the returned indices
 *  line up with the component's `[...name]` highlight even when a name contains an
 *  astral char (emoji) or one whose lowercase changes length (e.g. 'İ'). */
export function substringMatch(query: string, target: string): number[] | null {
  if (query === '') return []
  const t = [...target].map((c) => c.toLowerCase())
  const q = [...query].map((c) => c.toLowerCase())
  outer: for (let i = 0; i + q.length <= t.length; i++) {
    for (let j = 0; j < q.length; j++) if (t[i + j] !== q[j]) continue outer
    return Array.from({ length: q.length }, (_, k) => i + k)
  }
  return null
}

/** True when the object should be shown for `query`: empty query → true; else a
 *  substring hit on the object name OR on its schema name (so a schema query
 *  surfaces all of that schema's objects). */
export function objectMatches(obj: DbObject, query: string): boolean {
  if (query === '') return true
  if (substringMatch(query, obj.name) !== null) return true
  return obj.schema !== null && substringMatch(query, obj.schema) !== null
}

/** The objects to show, in original order (no re-ranking). Empty query → all. */
export function filterObjects(objects: DbObject[], query: string): DbObject[] {
  if (query === '') return objects
  return objects.filter((o) => objectMatches(o, query))
}
