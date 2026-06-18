import { parseEditKey, setAtPath } from './doc-path'

/** Map a react18-json-view edit — `parentPath` + `indexOrName`, relative to the documents
 *  ARRAY that's passed as the viewer's `src` — to our staged-edit identity: the document
 *  index (the array index) and the dotted field path within that document. Null when the
 *  path is empty, the row index isn't an integer, or any segment is `$`-prefixed (the value
 *  is inside an EJSON wrapper like `{$date}`/`{$oid}` — can't be `$set` safely). */
export function jsonEditTarget(
  parentPath: (string | number)[],
  indexOrName: string | number
): { rowIndex: number; path: string } | null {
  if (parentPath.length === 0) return null
  const rowIndex = Number(parentPath[0])
  if (!Number.isInteger(rowIndex)) return null
  const segs = [...parentPath.slice(1), indexOrName].map(String)
  if (segs.some((s) => s.startsWith('$'))) return null
  return { rowIndex, path: segs.join('.') }
}

/** Apply staged edits onto the documents for display, so the viewer shows pending values.
 *  Immutable: untouched documents keep their reference; the empty case returns the input. */
export function applyPendingEdits(
  documents: Record<string, unknown>[],
  edits: Record<string, unknown>
): Record<string, unknown>[] {
  const keys = Object.keys(edits)
  if (keys.length === 0) return documents
  const byRow = new Map<number, [string, unknown][]>()
  for (const k of keys) {
    const { rowIndex, path } = parseEditKey(k)
    ;(byRow.get(rowIndex) ?? byRow.set(rowIndex, []).get(rowIndex)!).push([path, edits[k]])
  }
  return documents.map((doc, i) => {
    const rowEdits = byRow.get(i)
    if (!rowEdits) return doc
    let next = doc
    for (const [path, v] of rowEdits) next = setAtPath(next, path, v)
    return next
  })
}
