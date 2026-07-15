import type { FilterQuery } from '../shared/query'

/** Stringify a cell for matching — JSON for objects/arrays, `String` otherwise (covers BigInt:
 *  `String(9007199254740993n)` → '9007199254740993'). Display formatting stays in the renderer. */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip surrounding double quotes (a `"quoted phrase"` term). */
function unquote(t: string): string {
  return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1) : t
}

/** Split the box text into tokens, keeping quoted spans and any leading `-`/`!` together:
 *  `foo -"a b" OR bar` → ['foo', '-"a b"', 'OR', 'bar']. */
export function tokenize(text: string): string[] {
  return text.match(/[-!]?(?:"[^"]*"|\S+)/g) ?? []
}

export interface ParsedTerms {
  positives: string[]
  negatives: string[]
  op: 'and' | 'or'
}

/** Parse the box text into positive/negative terms and the combine op. A bare `OR` token switches
 *  to OR; `-term`/`!term` negates; `"quoted"` is a literal phrase (and escapes a leading `-`). */
export function parseTerms(text: string): ParsedTerms {
  let op: 'and' | 'or' = 'and'
  const positives: string[] = []
  const negatives: string[] = []
  for (const tok of tokenize(text)) {
    if (tok === 'OR') {
      op = 'or'
      continue
    }
    let t = tok
    let neg = false
    if (t[0] === '-' || t[0] === '!') {
      neg = true
      t = t.slice(1)
    }
    t = unquote(t)
    if (t === '') continue
    ;(neg ? negatives : positives).push(t)
  }
  return { positives, negatives, op }
}

/** A compiled matcher over a row, plus whether the query was an INVALID regex. */
export interface Compiled {
  match: (row: unknown[]) => boolean
  invalid: boolean
}

function termMatcher(term: string, q: FilterQuery): (cell: string) => boolean {
  if (q.wholeWord) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, q.caseSensitive ? '' : 'i')
    return (cell) => re.test(cell)
  }
  const needle = q.caseSensitive ? term : term.toLowerCase()
  return (cell) => (q.caseSensitive ? cell : cell.toLowerCase()).includes(needle)
}

/**
 * Compile a filter query into a row matcher. Empty text matches everything. `regex` mode tests the
 * whole `text` as one RegExp per cell (invalid → matches nothing, `invalid: true`). Otherwise the
 * text is parsed into terms: positives combine by AND (or OR if an `OR` token is present), and any
 * negated term excludes the row. A term matches a row when any cell contains/word-matches it.
 */
export function compileQuery(q: FilterQuery): Compiled {
  if (q.text.trim() === '') return { match: () => true, invalid: false }
  if (q.regex) {
    let re: RegExp
    try {
      re = new RegExp(q.text, q.caseSensitive ? '' : 'i')
    } catch {
      return { match: () => false, invalid: true }
    }
    return { match: (row) => row.some((c) => re.test(stringify(c))), invalid: false }
  }
  const { positives, negatives, op } = parseTerms(q.text)
  const pos = positives.map((t) => termMatcher(t, q))
  const neg = negatives.map((t) => termMatcher(t, q))
  return {
    invalid: false,
    match: (row) => {
      const cells = row.map(stringify)
      const rowHas = (m: (c: string) => boolean): boolean => cells.some(m)
      const posOk = pos.length === 0 ? true : op === 'or' ? pos.some(rowHas) : pos.every(rowHas)
      return posOk && !neg.some(rowHas)
    },
  }
}

/** Original indexes of the rows matching the query — used to page matches + key edits stably. */
export function filterIndices(rows: unknown[][], q: FilterQuery): number[] {
  const c = compileQuery(q)
  const out: number[] = []
  for (let i = 0; i < rows.length; i++) if (c.match(rows[i])) out.push(i)
  return out
}
