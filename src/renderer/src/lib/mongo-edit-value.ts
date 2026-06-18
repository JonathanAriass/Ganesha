/** Convert the editor's text into a typed value for a Mongo `$set`, biased by the
 *  original cell value's type so a string field stays a string ("42" → "42", not 42).
 *  For any other original type the text is JSON-parsed (numbers, booleans, null,
 *  objects/arrays — the editor shows objects as JSON), falling back to the raw string
 *  when it won't parse. `null` (the NULL control) passes through. The driver then
 *  EJSON-deserializes, so an edited `{ "$oid": "…" }` round-trips to an ObjectId. */
export function coerceMongoEditValue(text: string | null, original: unknown): unknown {
  if (text === null) return null
  if (typeof original === 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Coerce a JSON-viewer edit (react18-json-view hands back an ALREADY-parsed value — e.g.
 *  editing a string field "42" yields the number 42) back to the original field's type, so
 *  a string field stays a string. null passes through. Non-strings are re-stringified and
 *  run through the same original-type-biased coercion. */
export function coerceLibraryEditValue(newValue: unknown, original: unknown): unknown {
  if (newValue === null) return null
  const text = typeof newValue === 'string' ? newValue : JSON.stringify(newValue)
  return coerceMongoEditValue(text, original)
}
