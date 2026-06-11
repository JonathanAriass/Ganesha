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

/** Quote/comment/escape rules differ enough between the server families that one
 *  scanner can't serve both: \ is an escape in mysql strings but literal in pg
 *  (standard_conforming_strings), and getting that wrong flips string/code parity
 *  for the rest of the text — a mis-split, the failure mode this module must not
 *  have. mariadb uses 'mysql'. */
export type SqlDialect = 'postgres' | 'mysql'

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

  /** Where the current chunk's content began (-1 when none yet). */
  get startOffset(): number {
    return this.contentStart
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
 *  closing quote, or end-of-source when unterminated. Doubled-quote escaping
 *  ('' / "" / ``) always applies; whether \ escapes is the caller's per-quote,
 *  per-dialect decision (see SqlDialect — both directions of getting it wrong
 *  mis-split, so there is no safe one-size-fits-all). */
function skipQuoted(source: string, start: number, quote: string, backslashEscapes: boolean): number {
  const n = source.length
  let i = start + 1
  while (i < n) {
    const c = source[i]
    if (backslashEscapes && c === '\\') {
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

/** Is the '...' opening at i a pg e'...' escape string (where \ does escape)?
 *  The e must be its own token: `name_e'x'` is an identifier then a plain string. */
function isEString(source: string, i: number): boolean {
  const prev = source[i - 1]
  if (prev !== 'e' && prev !== 'E') return false
  return i < 2 || !/[\w$]/.test(source[i - 2])
}

/** source[i] starts a word ([A-Za-z_], previous char not a word char). */
function readWord(source: string, i: number): string {
  let j = i + 1
  while (j < source.length && /[\w$]/.test(source[j])) j++
  return source.slice(i, j)
}

/** The next word after whitespace, lowercased ('' when something else follows),
 *  plus the index just past it. Comments between words defeat the peek
 *  (`end /* c … followed by if`) — accepted as contrived. */
function peekWord(source: string, from: number): { word: string; end: number } {
  let j = from
  while (j < source.length && /\s/.test(source[j])) j++
  if (j >= source.length || !/[A-Za-z_]/.test(source[j])) return { word: '', end: from }
  const word = readWord(source, j)
  return { word: word.toLowerCase(), end: j + word.length }
}

/** CREATE statements whose body is itself made of ;-separated statements. mysql:
 *  in the CLI you'd guard these with DELIMITER, but DELIMITER is a CLI construct —
 *  the server takes the whole CREATE as one statement, so the splitter must too.
 *  pg: only SQL-standard BEGIN ATOMIC bodies (pg 14+) need this — plpgsql bodies
 *  live inside $$ quotes and never reach the word scanner. A comment inside the
 *  head (between create and procedure) defeats detection — accepted as contrived. */
const ROUTINE_HEAD_MYSQL =
  /^create\s+(?:or\s+replace\s+)?(?:definer\s*=\s*\S+\s+)?(?:aggregate\s+)?(?:procedure|function|trigger|event)\b/i
const ROUTINE_HEAD_PG = /^create\s+(?:or\s+replace\s+)?(?:procedure|function)\b/i

/** mysql END IF/WHILE/LOOP/REPEAT close constructs whose openers we never count —
 *  IF/REPEAT are lexically ambiguous with the if()/repeat() functions, which also
 *  means a no-BEGIN compound body (`for each row if … end if`) stays a known
 *  mis-split; counting `if` as an opener would break far more common input. */
const SELF_CLOSING_END = new Set(['if', 'while', 'loop', 'repeat'])

/** Split SQL text on top-level semicolons. Both dialects: '' doubling, "double"
 *  and `backtick` quoting, -- line comments, nested block comments (pg nests
 *  them; plain text never closes early). postgres adds $tag$ dollar quoting and
 *  e'...' escape strings (plain '...' takes \ literally); mysql adds # comments
 *  and \ escapes in strings. Both get routine-body awareness — mysql CREATE
 *  PROCEDURE/FUNCTION/TRIGGER/EVENT BEGIN…END blocks and pg BEGIN ATOMIC bodies —
 *  so a body's semicolons separate body statements, not statements of the tab. */
export function splitSqlStatements(source: string, dialect: SqlDialect): Statement[] {
  const ch = new Chunker(source)
  const n = source.length
  const mysql = dialect === 'mysql'
  const dollarTag = /\$([A-Za-z_]\w*)?\$/y
  // Routine-body state: bodyDepth counts open begin/case blocks, but only once
  // the chunk's head proves it a routine — `BEGIN;` opening a transaction script
  // must keep splitting normally.
  const routineHead = mysql ? ROUTINE_HEAD_MYSQL : ROUTINE_HEAD_PG
  let routine: boolean | null = null
  let bodyDepth = 0
  const isRoutineChunk = (upto: number): boolean =>
    (routine ??= routineHead.test(source.slice(ch.startOffset, upto)))
  let i = 0
  while (i < n) {
    const c = source[i]
    if (c === '-' && source[i + 1] === '-') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? n : nl // the \n itself is plain whitespace
      continue
    }
    if (mysql && c === '#') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? n : nl
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
      // mysql: \ escapes in '...'/"..." strings but not `identifiers`;
      // pg: only in e'...' strings (plain strings take \ literally).
      const backslash = mysql ? c !== '`' : c === "'" && isEString(source, i)
      i = skipQuoted(source, i, c, backslash)
      continue
    }
    if (c === '$' && !mysql) {
      // pg-only: in mysql, $ is just an identifier character. `a$b$` identifiers
      // can look like a tag opener even in pg; mis-splitting additionally needs a
      // matching fake closer hidden in a string — accepted as improbable.
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
      if (bodyDepth > 0) {
        // Inside a routine body — this ; separates body statements, not chunks.
        ch.content(i)
        i++
        continue
      }
      ch.boundary(i + 1) // the semicolon belongs to the statement
      routine = null
      i++
      continue
    }
    if (/[A-Za-z_]/.test(c) && !/[\w$]/.test(source[i - 1] ?? '')) {
      const word = readWord(source, i)
      ch.content(i)
      const w = word.toLowerCase()
      if (w === 'begin' || w === 'case') {
        // `case` counts because a CASE *expression* ends with a bare END. pg only
        // counts BEGIN ATOMIC (the SQL-standard body form) — any other pg BEGIN
        // outside quotes is a transaction statement, never a block.
        if (
          isRoutineChunk(i) &&
          (w === 'case' || mysql || peekWord(source, i + word.length).word === 'atomic')
        ) {
          bodyDepth++
        }
      } else if (w === 'end' && isRoutineChunk(i)) {
        const next = peekWord(source, i + word.length)
        if (!mysql || !SELF_CLOSING_END.has(next.word)) {
          bodyDepth = Math.max(0, bodyDepth - 1)
        }
        if (next.word === 'case') {
          // END CASE is one closer — consume the case word, or the opener branch
          // above would re-count it on the next pass and the depth never closes.
          i = next.end
          continue
        }
      }
      i += word.length
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
// can't end an expression — the classic heuristic, plenty for shell commands. A
// regex right after a bare keyword (`return /a;b/`) is misread as division and can
// mis-split, but such input isn't a db.* expression, so the shell evaluator
// rejects it server-side either way.
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
      i = skipQuoted(source, i, c, true)
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

/** Does a new `db.` command start at/after `from`, looking through whitespace AND
 *  comments? Comments must be looked through, or a titled semicolon-less command —
 *  `db.x.find()` then a blank line, `// title`, `db.y.find()` — would absorb the
 *  next command's title into its own text, and a cursor on the title would run
 *  the wrong command (statementAt assigns gap lines to the following statement). */
function startsNewCommand(source: string, from: number): boolean {
  let i = from
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      if (nl === -1) return false
      i = nl + 1
    } else if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      if (close === -1) return false
      i = close + 2
    } else {
      break
    }
  }
  return source.startsWith('db.', i)
}

/** Heads that manage a session-scoped transaction. END is pg's COMMIT alias;
 *  SET TRANSACTION/autocommit configure the session's transaction behavior.
 *  BEGIN ATOMIC never reaches a statement head — routine bodies stay inside
 *  their CREATE statement (see splitSqlStatements). */
const TXN_HEAD =
  /^(begin|start|commit|rollback|end|savepoint|release)\b|^set\s+((session|global)\s+)?(transaction|autocommit)\b/i

/** Leading whitespace or one comment of either dialect (over-matching `#` on pg
 *  is fine — the only caller refuses conservatively). */
const LEADING_TRIVIA = /^(\s+|--[^\n]*\n?|#[^\n]*\n?|\/\*[\s\S]*?\*\/)/

/** Does this statement begin with transaction control (BEGIN/COMMIT/…)? Run-all
 *  executes statements as separate pooled runs, so a transaction can't span them —
 *  worse, a lone BEGIN would go back to the pool still open and leak an
 *  in-transaction session into later runs. Callers refuse such scripts outright:
 *  refusing beats silently-broken semantics. */
export function isTransactionControl(sql: string): boolean {
  let s = sql
  for (;;) {
    const next = s.replace(LEADING_TRIVIA, '')
    if (next === s) break
    s = next
  }
  return TXN_HEAD.test(s)
}

/** The statement the cursor is in. Regions tile the text: a statement owns from
 *  its start through the rest of its last line — so a cursor right after a
 *  just-typed `select 1;` runs it — and the next line begins the following
 *  statement's region, so a title comment above a statement runs the statement it
 *  titles, not the previous one. Offsets before the first statement clamp to it. */
export function statementAt(
  source: string,
  statements: Statement[],
  offset: number
): Statement | null {
  if (statements.length === 0) return null
  let pick = statements[0]
  for (let k = 1; k < statements.length; k++) {
    const s = statements[k]
    const nl = source.indexOf('\n', statements[k - 1].end)
    const regionStart = nl !== -1 && nl < s.start ? nl + 1 : s.start
    if (regionStart <= offset) pick = s
    else break
  }
  return pick
}
