export interface Segment {
  text: string
  hit: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split `text` into highlighted (`hit`) and plain segments for the active search terms. In `regex`
 * mode the first term is a regex source tested against the text; otherwise each term is matched as a
 * substring (or whole-word). Case per `caseSensitive`. Returns a single non-hit segment when there's
 * nothing to highlight or the pattern is invalid — so callers can always render the segments.
 */
export function highlightSegments(
  text: string,
  terms: string[],
  opts: { regex: boolean; caseSensitive: boolean; wholeWord: boolean },
): Segment[] {
  if (text === '' || terms.length === 0) return [{ text, hit: false }]
  let re: RegExp
  try {
    const flags = opts.caseSensitive ? 'g' : 'gi'
    if (opts.regex) {
      re = new RegExp(terms[0], flags)
    } else {
      const alt = terms
        .filter((t) => t !== '')
        .map((t) => (opts.wholeWord ? `\\b${escapeRegExp(t)}\\b` : escapeRegExp(t)))
        .join('|')
      if (alt === '') return [{ text, hit: false }]
      re = new RegExp(alt, flags)
    }
  } catch {
    return [{ text, hit: false }]
  }
  const segs: Segment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m[0] === '') break // guard a zero-width pattern (e.g. `a*`) from looping / empty spam
    const i = m.index ?? 0
    if (i > last) segs.push({ text: text.slice(last, i), hit: false })
    segs.push({ text: m[0], hit: true })
    last = i + m[0].length
  }
  if (segs.length === 0) return [{ text, hit: false }]
  if (last < text.length) segs.push({ text: text.slice(last), hit: false })
  return segs
}
