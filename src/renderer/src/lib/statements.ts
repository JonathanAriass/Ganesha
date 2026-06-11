/** Statement splitting for scratchpad tabs: ⌘↵ runs the statement under the cursor,
 *  so a tab can hold many statements even though the drivers execute one at a time
 *  (mysql2 runs with multipleStatements off; the mongo parsers take one command).
 *
 *  These are lenient lexical scanners, not parsers: they only need to find the
 *  boundaries strings/comments can hide. On malformed input (unterminated string,
 *  open comment) the rest of the text becomes one statement — no-split beats
 *  mis-split, since the server then reports the real syntax error. */

export interface Statement {
  /** The statement's text (trailing whitespace stripped, semicolon kept). */
  text: string
  /** Offset of the statement's first character in the source. */
  start: number
  /** Offset just past the statement's last character. */
  end: number
}

/** Accumulates chunks between boundaries, dropping comment/whitespace-only ones
 *  (a trailing `-- done` is not a runnable statement). */
class Chunker {
  readonly out: Statement[] = []
  private contentStart = -1
  constructor(private source: string) {}

  /** Mark offset i as real content (not whitespace/comment). */
  content(i: number): void {
    if (this.contentStart === -1) this.contentStart = i
  }

  get started(): boolean {
    return this.contentStart !== -1
  }

  /** Close the current chunk; [contentStart, endExclusive) becomes a statement. */
  boundary(endExclusive: number): void {
    if (this.contentStart !== -1) {
      const text = this.source.slice(this.contentStart, endExclusive).trimEnd()
      this.out.push({ text, start: this.contentStart, end: this.contentStart + text.length })
    }
    this.contentStart = -1
  }
}

/** Skip a quoted run (source[start] is the quote); returns the index just past the
 *  closing quote, or end-of-source when unterminated. Handles backslash escapes and
 *  doubled-quote escaping ('' / "" / ``). Treating \ as an escape is the mysql rule;
 *  a standard-conforming pg string ending in a literal backslash ('C:\') over-scans,
 *  which at worst merges two statements — the lenient direction. */
function skipQuoted(source: string, start: number, quote: string): number {
  const n = source.length
  let i = start + 1
  while (i < n) {
    const c = source[i]
    if (c === '\\') {
      i += 2
    } else if (c === quote) {
      if (source[i + 1] === quote) i += 2
      else return i + 1
    } else {
      i++
    }
  }
  return n
}

/** Split SQL text on top-level semicolons. Dialect-agnostic superset: '' and \
 *  escapes, "double" and `backtick` identifiers, -- line comments, nested block
 *  comments (pg nests them; plain text never closes early), $tag$ dollar quoting. */
export function splitSqlStatements(source: string): Statement[] {
  const ch = new Chunker(source)
  const n = source.length
  const dollarTag = /\$([A-Za-z_]\w*)?\$/y
  let i = 0
  while (i < n) {
    const c = source[i]
    if (c === '-' && source[i + 1] === '-') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? n : nl // the \n itself is plain whitespace
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') {
          depth++
          i += 2
        } else if (source[i] === '*' && source[i + 1] === '/') {
          depth--
          i += 2
        } else {
          i++
        }
      }
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      ch.content(i)
      i = skipQuoted(source, i, c)
      continue
    }
    if (c === '$') {
      dollarTag.lastIndex = i
      const m = dollarTag.exec(source)
      if (m) {
        ch.content(i)
        const close = source.indexOf(m[0], i + m[0].length)
        i = close === -1 ? n : close + m[0].length
        continue
      }
      ch.content(i)
      i++
      continue
    }
    if (c === ';') {
      ch.boundary(i + 1) // the semicolon belongs to the statement
      i++
      continue
    }
    if (!/\s/.test(c)) ch.content(i)
    i++
  }
  ch.boundary(n)
  return ch.out
}

/** Skip a regex literal (source[start] === '/'); '/' inside a [class] doesn't close.
 *  A regex can't span lines, so a newline means we misread a division — bail there. */
function skipRegex(source: string, start: number): number {
  const n = source.length
  let i = start + 1
  let inClass = false
  while (i < n) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) {
      i++
      break
    } else if (c === '\n') return i
    i++
  }
  while (i < n && /[a-z]/i.test(source[i])) i++ // flags
  return i
}

// A '/' starts a regex literal (not division) when the previous significant char
// can't end an expression — the classic heuristic, plenty for shell commands.
const BEFORE_REGEX = /[(,;:=[{!&|?+\-*%<>~^]/

/** Split mongo-shell text into commands: top-level (paren/bracket/brace depth 0)
 *  semicolons, plus the shell habit of just starting the next line with `db.` —
 *  a newline directly before `db.` at depth 0 also ends the command. Strings,
 *  comments and regex literals are skipped; template literals are treated as plain
 *  strings (no ${} scanning — the shell evaluator only takes literals anyway). */
export function splitJsCommands(source: string): Statement[] {
  const ch = new Chunker(source)
  const n = source.length
  let i = 0
  let depth = 0
  let lastSig = '' // last significant code character ('' = none in this chunk)
  while (i < n) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? n : nl
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      i = close === -1 ? n : close + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      ch.content(i)
      lastSig = c
      i = skipQuoted(source, i, c)
      continue
    }
    if (c === '/') {
      ch.content(i)
      if (lastSig === '' || BEFORE_REGEX.test(lastSig)) {
        i = skipRegex(source, i)
      } else {
        i++ // division
      }
      lastSig = '/'
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      ch.content(i)
      lastSig = c
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      depth = Math.max(0, depth - 1)
      ch.content(i)
      lastSig = c
      i++
      continue
    }
    if (c === ';' && depth === 0) {
      ch.boundary(i + 1)
      lastSig = ''
      i++
      continue
    }
    if (c === '\n' && depth === 0 && ch.started && startsNewCommand(source, i + 1)) {
      ch.boundary(i) // the newline is not part of the statement
      lastSig = ''
      i++
      continue
    }
    if (!/\s/.test(c)) {
      ch.content(i)
      lastSig = c
    }
    i++
  }
  ch.boundary(n)
  return ch.out
}

function startsNewCommand(source: string, from: number): boolean {
  let i = from
  while (i < source.length && /\s/.test(source[i])) i++
  return source.startsWith('db.', i)
}

/** The statement the cursor is in. Regions tile the text — each statement owns
 *  [its start, next statement's start), so a cursor in the gap right after
 *  `select 1;` still picks that statement (what you want mid-typing); offsets
 *  before the first statement clamp to it. */
export function statementAt(statements: Statement[], offset: number): Statement | null {
  if (statements.length === 0) return null
  let pick = statements[0]
  for (const s of statements) {
    if (s.start <= offset) pick = s
    else break
  }
  return pick
}
