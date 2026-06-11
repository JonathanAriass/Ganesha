import { describe, expect, it } from 'vitest'
import { splitSqlStatements, splitJsCommands, statementAt, type Statement } from './statements'

const texts = (out: Statement[]): string[] => out.map((s) => s.text)

describe('splitSqlStatements', () => {
  it('splits on semicolons, keeping the semicolon and exact offsets', () => {
    const out = splitSqlStatements('select 1; select 2')
    expect(out).toEqual([
      { text: 'select 1;', start: 0, end: 9 },
      { text: 'select 2', start: 10, end: 18 }
    ])
  })

  it('a tab without semicolons is one statement', () => {
    expect(texts(splitSqlStatements('select *\nfrom users'))).toEqual(['select *\nfrom users'])
  })

  it("ignores semicolons inside 'single quotes'", () => {
    expect(texts(splitSqlStatements("select 'a;b' as x; select 2"))).toEqual([
      "select 'a;b' as x;",
      'select 2'
    ])
  })

  it("handles doubled-quote escaping: 'it''s'", () => {
    expect(texts(splitSqlStatements("select 'it''s; fine'; select 2"))).toEqual([
      "select 'it''s; fine';",
      'select 2'
    ])
  })

  it('handles backslash escapes (mysql strings)', () => {
    expect(texts(splitSqlStatements("select 'a\\';b'; select 2"))).toEqual([
      "select 'a\\';b';",
      'select 2'
    ])
  })

  it('ignores semicolons inside "double" and `backtick` identifiers', () => {
    expect(texts(splitSqlStatements('select "a;b", `c;d` from t; select 2'))).toEqual([
      'select "a;b", `c;d` from t;',
      'select 2'
    ])
  })

  it('ignores semicolons inside -- line comments', () => {
    expect(texts(splitSqlStatements('select 1 -- not a split ;\n; select 2'))).toEqual([
      'select 1 -- not a split ;\n;',
      'select 2'
    ])
  })

  it('ignores semicolons inside /* block comments */ and nests them (pg)', () => {
    expect(texts(splitSqlStatements('select 1 /* a ; /* b ; */ c ; */; select 2'))).toEqual([
      'select 1 /* a ; /* b ; */ c ; */;',
      'select 2'
    ])
  })

  it('ignores semicolons inside $$ dollar quotes', () => {
    expect(texts(splitSqlStatements('select $$a;b$$; select 2'))).toEqual([
      'select $$a;b$$;',
      'select 2'
    ])
  })

  it('matches tagged dollar quotes by exact tag', () => {
    // The inner $$ must not close $fn$ — only the exact tag does.
    const sql = 'do $fn$ begin select $$x;y$$; end $fn$; select 2'
    expect(texts(splitSqlStatements(sql))).toEqual([
      'do $fn$ begin select $$x;y$$; end $fn$;',
      'select 2'
    ])
  })

  it('treats $1 positional params as plain text, not dollar quotes', () => {
    expect(texts(splitSqlStatements('select $1; select $2'))).toEqual(['select $1;', 'select $2'])
  })

  it('drops empty chunks from stray semicolons', () => {
    expect(texts(splitSqlStatements(';;select 1;; ;'))).toEqual(['select 1;'])
  })

  it('drops a trailing comment-only chunk', () => {
    expect(texts(splitSqlStatements('select 1;\n-- the end'))).toEqual(['select 1;'])
  })

  it('drops a comment-only chunk between statements', () => {
    const out = splitSqlStatements('select 1;\n/* between */;\nselect 2')
    expect(texts(out)).toEqual(['select 1;', 'select 2'])
  })

  it('whitespace-only input yields no statements', () => {
    expect(splitSqlStatements('  \n\t ')).toEqual([])
  })

  it('an unterminated string swallows the rest (no-split beats mis-split)', () => {
    expect(texts(splitSqlStatements("select 'oops; select 2"))).toEqual(["select 'oops; select 2"])
  })

  it('an unterminated dollar quote swallows the rest', () => {
    expect(texts(splitSqlStatements('select $$oops; select 2'))).toEqual(['select $$oops; select 2'])
  })

  it('statement start skips leading comments and whitespace', () => {
    const sql = '-- header\nselect 1;'
    const out = splitSqlStatements(sql)
    expect(out).toEqual([{ text: 'select 1;', start: 10, end: 19 }])
  })
})

describe('splitJsCommands', () => {
  it('splits on top-level semicolons', () => {
    const out = splitJsCommands('db.users.find();db.orders.find()')
    expect(out).toEqual([
      { text: 'db.users.find();', start: 0, end: 16 },
      { text: 'db.orders.find()', start: 16, end: 32 }
    ])
  })

  it('splits on a newline directly before db. (shell habit, no semicolons)', () => {
    expect(texts(splitJsCommands('db.users.find()\ndb.orders.find()'))).toEqual([
      'db.users.find()',
      'db.orders.find()'
    ])
  })

  it('does NOT split a chained modifier continuation line', () => {
    const src = 'db.users.find({ active: true })\n  .sort({ name: 1 })\n  .limit(5)'
    expect(texts(splitJsCommands(src))).toEqual([src])
  })

  it('does not split on newline when the next line is not db.', () => {
    expect(texts(splitJsCommands('db.users.find(\n)\n'))).toEqual(['db.users.find(\n)'])
  })

  it('ignores semicolons inside strings', () => {
    expect(texts(splitJsCommands('db.users.find({ note: "a;b" });db.orders.find()'))).toEqual([
      'db.users.find({ note: "a;b" });',
      'db.orders.find()'
    ])
  })

  it('ignores semicolons inside template literals', () => {
    expect(texts(splitJsCommands('db.users.find({ s: `a;b` });db.orders.find()'))).toEqual([
      'db.users.find({ s: `a;b` });',
      'db.orders.find()'
    ])
  })

  it('ignores semicolons nested in parens/braces (depth > 0)', () => {
    const src = 'db.foo.aggregate([{ $match: { a: 1 } }]);db.bar.find()'
    expect(texts(splitJsCommands(src))).toEqual([
      'db.foo.aggregate([{ $match: { a: 1 } }]);',
      'db.bar.find()'
    ])
  })

  it('the newline-before-db. rule is depth-guarded', () => {
    // A line starting with db. inside an open bracket is still the same command.
    const src = 'db.foo.aggregate([\n  db.x\n])'
    expect(texts(splitJsCommands(src))).toEqual([src])
  })

  it('skips regex literals (a ; inside one is not a boundary)', () => {
    const out = splitJsCommands('/a;b/.test(s); db.users.find()')
    expect(texts(out)).toEqual(['/a;b/.test(s);', 'db.users.find()'])
  })

  it('skips regex literals with flags and char classes', () => {
    const src = 'db.users.find({ name: /[/;]x/gi })\ndb.orders.find()'
    expect(texts(splitJsCommands(src))).toEqual([
      'db.users.find({ name: /[/;]x/gi })',
      'db.orders.find()'
    ])
  })

  it('reads / after a value as division, not a regex opener', () => {
    // If misread as a regex, the scan would swallow the ; and merge both commands.
    expect(texts(splitJsCommands('x = 10 / 2;db.users.find()'))).toEqual([
      'x = 10 / 2;',
      'db.users.find()'
    ])
  })

  it('ignores ; and db. lines inside // comments', () => {
    const src = 'db.users.find() // trailing ; note\ndb.orders.find()'
    expect(texts(splitJsCommands(src))).toEqual([
      'db.users.find() // trailing ; note',
      'db.orders.find()'
    ])
  })

  it('ignores ; inside /* block comments */', () => {
    expect(texts(splitJsCommands('db.users.find() /* a;b */;db.orders.find()'))).toEqual([
      'db.users.find() /* a;b */;',
      'db.orders.find()'
    ])
  })

  it('drops comment-only and empty chunks', () => {
    expect(texts(splitJsCommands('// header\ndb.users.find();;\n// done'))).toEqual([
      'db.users.find();'
    ])
  })

  it('an unterminated string swallows the rest', () => {
    const src = 'db.users.find({ s: "oops });db.orders.find()'
    expect(texts(splitJsCommands(src))).toEqual([src])
  })

  it('unbalanced closers do not push depth negative', () => {
    // Malformed input — the stray ) must not disable splitting forever after.
    expect(texts(splitJsCommands('x());db.users.find()'))).toEqual(['x());', 'db.users.find()'])
  })
})

describe('statementAt', () => {
  const stmts = splitSqlStatements('select 1; select 2')

  it('returns the statement containing the offset', () => {
    expect(statementAt(stmts, 3)?.text).toBe('select 1;')
    expect(statementAt(stmts, 12)?.text).toBe('select 2')
  })

  it('a cursor in the gap right after a statement picks that statement', () => {
    // Regions tile: offset 9 is just past `select 1;` but before `select 2` starts.
    expect(statementAt(stmts, 9)?.text).toBe('select 1;')
  })

  it('clamps offsets before the first statement to it', () => {
    const padded = splitSqlStatements('  select 1; select 2')
    expect(padded[0].start).toBe(2)
    expect(statementAt(padded, 0)?.text).toBe('select 1;')
  })

  it('an offset at or past the end picks the last statement', () => {
    expect(statementAt(stmts, 18)?.text).toBe('select 2')
    expect(statementAt(stmts, 999)?.text).toBe('select 2')
  })

  it('returns null for no statements', () => {
    expect(statementAt([], 0)).toBeNull()
  })
})
