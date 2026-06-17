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
