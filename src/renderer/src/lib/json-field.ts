/**
 * Decide whether a field value should be edited as a JSON tree (react18-json-view) rather than a
 * one-line text box. Returns the tree to render plus `wasString`:
 *   - `wasString:false` — the value already IS an object/array (Mongo subdoc, pg `jsonb`); a
 *     re-serialized edit is staged as an object.
 *   - `wasString:true`  — the value is a STRING that parses to an object/array (`json`-as-text);
 *     the edit is re-serialized back to a JSON string so the field keeps its string form.
 * Returns null for scalars, plain (non-JSON) strings, null, and malformed JSON — those keep the
 * plain inline editor.
 */
export function asJsonTree(v: unknown): { tree: object; wasString: boolean } | null {
  if (v !== null && typeof v === 'object') return { tree: v, wasString: false }
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(v)
        if (parsed !== null && typeof parsed === 'object') return { tree: parsed, wasString: true }
      } catch {
        // not JSON after all — fall through to null
      }
    }
  }
  return null
}
