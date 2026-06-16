import type { DbObject } from '@shared/schema'

/** Case-insensitive substring ("contains") match. Returns the matched character
 *  indices in `target` (the contiguous run, for highlighting), or null if `query`
 *  does not occur in `target`. An empty query returns [] (matches everything). */
export function substringMatch(query: string, target: string): number[] | null {
  if (query === '') return []
  const at = target.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return null
  return Array.from({ length: query.length }, (_, i) => at + i)
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
