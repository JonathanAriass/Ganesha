import type { FilterQuery, ColumnFilter, ColumnOp } from '../shared/query'

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

/** The GLOBAL (any-column) part of a query: the box text + toggles. Empty text matches everything;
 *  `regex` mode is one RegExp per cell; else parsed terms (AND/OR + negation). */
function compileGlobal(q: FilterQuery): Compiled {
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

/** A finite number from a cell/value, else null (a blank string is NOT 0). */
function asNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Does one cell satisfy a column constraint? */
function matchColumn(cell: unknown, cf: ColumnFilter, caseSensitive: boolean): boolean {
  if (cf.op === 'gt' || cf.op === 'lt' || cf.op === 'ge' || cf.op === 'le') {
    const a = asNum(cell)
    const b = asNum(cf.value)
    if (a === null || b === null) return false
    return cf.op === 'gt' ? a > b : cf.op === 'lt' ? a < b : cf.op === 'ge' ? a >= b : a <= b
  }
  if (cf.op === 'eq' || cf.op === 'ne') {
    const a = asNum(cell)
    const b = asNum(cf.value)
    const eq = a !== null && b !== null ? a === b : caseSensitive
      ? stringify(cell) === cf.value
      : stringify(cell).toLowerCase() === cf.value.toLowerCase()
    return cf.op === 'eq' ? eq : !eq
  }
  const hay = caseSensitive ? stringify(cell) : stringify(cell).toLowerCase()
  const needle = caseSensitive ? cf.value : cf.value.toLowerCase()
  return cf.op === 'contains' ? hay.includes(needle) : !hay.includes(needle)
}

/** Pull `colname<op>value` terms (where colname is a known column) out of the box text — the box
 *  syntax — returning them as column constraints plus the leftover GLOBAL text. Separators: `=`
 *  `!=` `>` `<` `>=` `<=` (compare) and `:` (contains). Unknown columns / plain terms stay global. */
export function splitBoxColumns(text: string, columnNames: string[]): { globalText: string; columns: ColumnFilter[] } {
  const index = new Map(columnNames.map((n, i) => [n.toLowerCase(), i]))
  const columns: ColumnFilter[] = []
  const global: string[] = []
  for (const tok of tokenize(text)) {
    const m = tok.match(/^(\w+)(>=|<=|!=|>|<|=|:)(.+)$/)
    const col = m ? index.get(m[1].toLowerCase()) : undefined
    if (m && col !== undefined) {
      const sep = m[2]
      const value = unquote(m[3])
      const op: ColumnOp =
        sep === '>=' ? 'ge' : sep === '<=' ? 'le' : sep === '>' ? 'gt' : sep === '<' ? 'lt'
        : sep === '=' ? 'eq' : sep === '!=' ? 'ne' : 'contains'
      columns.push({ column: col, op, value })
    } else {
      global.push(tok)
    }
  }
  return { globalText: global.join(' '), columns }
}

/** Compile a full query — the global part AND every per-column constraint (from the filter row AND
 *  `colname op value` box syntax, resolved against `columnNames`). */
export function compileQuery(q: FilterQuery, columnNames: string[] = []): Compiled {
  // Box column-syntax only in non-regex mode (in regex mode the whole text is one pattern).
  const box = q.regex ? { globalText: q.text, columns: [] } : splitBoxColumns(q.text, columnNames)
  const global = compileGlobal({ ...q, text: box.globalText })
  if (global.invalid) return { match: () => false, invalid: true }
  const cols = [...box.columns, ...(q.columns ?? [])]
  if (cols.length === 0) return global
  return {
    invalid: false,
    match: (row) => global.match(row) && cols.every((cf) => matchColumn(row[cf.column], cf, q.caseSensitive)),
  }
}

/** The terms to visually highlight in matched cells: the positive GLOBAL terms (column-qualified
 *  and negated terms excluded) — or the regex source in regex mode. Empty when there's nothing to
 *  highlight (empty / column-only / negation-only query). */
export function highlightTerms(q: FilterQuery, columnNames: string[] = []): string[] {
  if (q.text.trim() === '') return []
  if (q.regex) return [q.text]
  return parseTerms(splitBoxColumns(q.text, columnNames).globalText).positives
}

/** Original indexes of the rows matching the query — used to page matches + key edits stably. */
export function filterIndices(rows: unknown[][], q: FilterQuery): number[] {
  const c = compileQuery(q)
  const out: number[] = []
  for (let i = 0; i < rows.length; i++) if (c.match(rows[i])) out.push(i)
  return out
}
