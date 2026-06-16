import type { DbObject } from '@shared/schema'

/** Case-insensitive greedy subsequence match. Returns the matched character
 *  indices in `target` (for highlighting), or null if `query` is not a
 *  subsequence of `target`. An empty query returns [] (matches everything). */
export function fuzzyMatch(query: string, target: string): number[] | null {
  if (query === '') return []
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const positions: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti)
      qi++
    }
  }
  return qi === q.length ? positions : null
}

/** True when the object should be shown for `query`: empty query → true; else a
 *  fuzzy hit on the object name OR on its schema name (so a schema query surfaces
 *  all of that schema's objects). */
export function objectMatches(obj: DbObject, query: string): boolean {
  if (query === '') return true
  if (fuzzyMatch(query, obj.name) !== null) return true
  return obj.schema !== null && fuzzyMatch(query, obj.schema) !== null
}

/** The objects to show, in original order (no re-ranking). Empty query → all. */
export function filterObjects(objects: DbObject[], query: string): DbObject[] {
  if (query === '') return objects
  return objects.filter((o) => objectMatches(o, query))
}
