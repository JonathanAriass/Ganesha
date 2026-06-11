import { describe, expect, it } from 'vitest'
import {
  splitSqlStatements,
  splitJsCommands,
  statementAt,
  isTransactionControl,
  type Statement
} from './statements'

const texts = (out: Statement[]): string[] => out.map((s) => s.text)
const pg = (source: string): Statement[] => splitSqlStatements(source, 'postgres')
const my = (source: string): Statement[] => splitSqlStatements(source, 'mysql')

describe('splitSqlStatements (both dialects)', () => {
  it('splits on semicolons, keeping the semicolon and exact offsets', () => {
    for (const split of [pg, my]) {
      expect(split('select 1; select 2')).toEqual([
        { text: 'select 1;', start: 0, end: 9 },
        { text: 'select 2', start: 10, end: 18 }
      ])
    }
  })

  it('a tab without semicolons is one statement', () => {
    expect(texts(pg('select *\nfrom users'))).toEqual(['select *\nfrom users'])
  })

  it("ignores semicolons inside 'single quotes'", () => {
    for (const split of [pg, my]) {
      expect(texts(split("select 'a;b' as x; select 2"))).toEqual([
        "select 'a;b' as x;",
        'select 2'
      ])
    }
  })

  it("handles doubled-quote escaping: 'it''s'", () => {
    for (const split of [pg, my]) {
      expect(texts(split("select 'it''s; fine'; select 2"))).toEqual([
        "select 'it''s; fine';",
        'select 2'
      ])
    }
  })

  it('ignores semicolons inside "double" and `backtick` quoting', () => {
    for (const split of [pg, my]) {
      expect(texts(split('select "a;b", `c;d` from t; select 2'))).toEqual([
        'select "a;b", `c;d` from t;',
        'select 2'
      ])
    }
  })

  it('ignores semicolons inside -- line comments', () => {
    expect(texts(pg('select 1 -- not a split ;\n; select 2'))).toEqual([
      'select 1 -- not a split ;\n;',
      'select 2'
    ])
  })

  it('ignores semicolons inside /* block comments */ and nests them (pg)', () => {
    expect(texts(pg('select 1 /* a ; /* b ; */ c ; */; select 2'))).toEqual([
      'select 1 /* a ; /* b ; */ c ; */;',
      'select 2'
    ])
  })

  it('drops empty chunks from stray semicolons', () => {
    expect(texts(pg(';;select 1;; ;'))).toEqual(['select 1;'])
  })

  it('drops a trailing comment-only chunk', () => {
    expect(texts(pg('select 1;\n-- the end'))).toEqual(['select 1;'])
  })

  it('drops a comment-only chunk between statements', () => {
    expect(texts(pg('select 1;\n/* between */;\nselect 2'))).toEqual(['select 1;', 'select 2'])
  })

  it('whitespace-only input yields no statements', () => {
    expect(pg('  \n\t ')).toEqual([])
  })

  it('an unterminated string swallows the rest (no-split beats mis-split)', () => {
    for (const split of [pg, my]) {
      expect(texts(split("select 'oops; select 2"))).toEqual(["select 'oops; select 2"])
    }
  })

  it('handles CRLF line endings', () => {
    expect(pg('select 1;\r\nselect 2')).toEqual([
      { text: 'select 1;', start: 0, end: 9 },
      { text: 'select 2', start: 11, end: 19 }
    ])
  })

  it('statement start skips leading comments and whitespace', () => {
    expect(pg('-- header\nselect 1;')).toEqual([{ text: 'select 1;', start: 10, end: 19 }])
  })
})

describe('splitSqlStatements (postgres)', () => {
  it('takes backslash literally in plain strings (standard_conforming_strings)', () => {
    // 'C:\' is a complete pg string; treating \ as an escape would over-scan,
    // flip string/code parity, and split inside the next real string.
    expect(texts(pg("select 'C:\\' || name; select 2"))).toEqual([
      "select 'C:\\' || name;",
      'select 2'
    ])
  })

  it('treats backslash as an escape inside e-strings', () => {
    expect(texts(pg("select e'a\\';b' as x; select 2"))).toEqual([
      "select e'a\\';b' as x;",
      'select 2'
    ])
  })

  it("an identifier ending in e does not make the next string an e-string", () => {
    expect(texts(pg("select name_e'a\\'; select 2"))).toEqual([
      "select name_e'a\\';",
      'select 2'
    ])
  })

  it('# is the XOR operator, not a comment', () => {
    expect(texts(pg('select 5 # 3; select 2'))).toEqual(['select 5 # 3;', 'select 2'])
  })

  it('ignores semicolons inside $$ dollar quotes', () => {
    expect(texts(pg('select $$a;b$$; select 2'))).toEqual(['select $$a;b$$;', 'select 2'])
  })

  it('matches tagged dollar quotes by exact tag', () => {
    // The inner $$ must not close $fn$ — only the exact tag does.
    expect(texts(pg('do $fn$ begin select $$x;y$$; end $fn$; select 2'))).toEqual([
      'do $fn$ begin select $$x;y$$; end $fn$;',
      'select 2'
    ])
  })

  it('treats $1 positional params as plain text, not dollar quotes', () => {
    expect(texts(pg('select $1; select $2'))).toEqual(['select $1;', 'select $2'])
  })

  it('an unterminated dollar quote swallows the rest', () => {
    expect(texts(pg('select $$oops; select 2'))).toEqual(['select $$oops; select 2'])
  })

  it('keeps a BEGIN ATOMIC body (pg 14+) as one statement', () => {
    const sql = [
      'create function add(a int, b int) returns int',
      'language sql',
      'begin atomic',
      '  select a + b;',
      'end;',
      'select 99;'
    ].join('\n')
    expect(texts(pg(sql))).toEqual([
      'create function add(a int, b int) returns int\nlanguage sql\nbegin atomic\n  select a + b;\nend;',
      'select 99;'
    ])
  })

  it('CASE expressions inside a BEGIN ATOMIC body stay balanced', () => {
    const sql =
      'create procedure flip() language sql begin atomic update t set n = case when n > 0 then 0 else 1 end; end; select 3'
    const out = texts(pg(sql))
    expect(out).toHaveLength(2)
    expect(out[1]).toBe('select 3')
  })

  it('a RETURN-form SQL function ends at its semicolon', () => {
    expect(texts(pg('create function one() returns int return 1; select 2'))).toEqual([
      'create function one() returns int return 1;',
      'select 2'
    ])
  })

  it('BEGIN as a transaction statement still splits normally', () => {
    expect(texts(pg('begin; select 1; commit;'))).toEqual(['begin;', 'select 1;', 'commit;'])
  })
})

describe('splitSqlStatements (mysql)', () => {
  it('treats backslash as an escape in strings', () => {
    expect(texts(my("select 'a\\';b'; select 2"))).toEqual(["select 'a\\';b';", 'select 2'])
  })

  it('does not treat backslash as an escape in `identifiers`', () => {
    expect(texts(my('select `a\\`; select 2'))).toEqual(['select `a\\`;', 'select 2'])
  })

  it('treats # as a line comment', () => {
    expect(texts(my('select 1 # note ;\n; select 2'))).toEqual([
      'select 1 # note ;\n;',
      'select 2'
    ])
  })

  it('a trailing #-comment is not a statement', () => {
    expect(texts(my('select 1;\n# done'))).toEqual(['select 1;'])
  })

  it('does not treat $tag$ as a quote (no dollar quoting in mysql)', () => {
    expect(texts(my('select $a$ ; select $a$'))).toEqual(['select $a$ ;', 'select $a$'])
  })

  it('keeps a routine body with BEGIN…END as one statement', () => {
    const sql =
      'create procedure bump()\nbegin\n  update counters set n = n + 1;\n  select n from counters;\nend;\nselect 99;'
    expect(texts(my(sql))).toEqual([
      'create procedure bump()\nbegin\n  update counters set n = n + 1;\n  select n from counters;\nend;',
      'select 99;'
    ])
  })

  it('handles nested blocks and CASE expressions inside a routine body', () => {
    const sql = [
      'create function f() returns int',
      'begin',
      '  declare v int;',
      '  begin',
      '    set v = (select case when 1 then 2 else 3 end);',
      '  end;',
      '  return v;',
      'end;',
      'select 1;'
    ].join('\n')
    const out = texts(my(sql))
    expect(out).toHaveLength(2)
    expect(out[0].endsWith('end;')).toBe(true)
    expect(out[1]).toBe('select 1;')
  })

  it('END CASE closes its CASE statement as one closer, not end + case', () => {
    const sql = [
      'create procedure p()',
      'begin',
      '  case x',
      '    when 1 then select 1;',
      '  end case;',
      'end;',
      'select 99;'
    ].join('\n')
    const out = texts(my(sql))
    expect(out).toHaveLength(2)
    expect(out[1]).toBe('select 99;')
  })

  it('END IF closes its IF, not the routine BEGIN', () => {
    const sql = [
      'create trigger t before insert on x for each row',
      'begin',
      '  if new.n > 1 then',
      '    set new.n = 1;',
      '  end if;',
      'end;',
      'select 2;'
    ].join('\n')
    const out = texts(my(sql))
    expect(out).toHaveLength(2)
    expect(out[1]).toBe('select 2;')
  })

  it('a single-statement routine body (no BEGIN) ends at its semicolon', () => {
    expect(texts(my('create procedure p() select 1; select 2;'))).toEqual([
      'create procedure p() select 1;',
      'select 2;'
    ])
  })

  it('BEGIN as a transaction statement still splits normally', () => {
    // Body suspension is gated on the chunk being a CREATE routine.
    expect(texts(my('begin; select 1; commit;'))).toEqual(['begin;', 'select 1;', 'commit;'])
  })

  it('CASE expressions outside routines do not affect splitting', () => {
    expect(texts(my("select case when a=1 then ';' else 'x' end from t; select 2"))).toEqual([
      "select case when a=1 then ';' else 'x' end from t;",
      'select 2'
    ])
  })

  it('recognizes DEFINER routines', () => {
    const sql = 'create definer=`root`@`localhost` procedure p()\nbegin\n  select 1;\nend;\nselect 2;'
    const out = texts(my(sql))
    expect(out).toHaveLength(2)
    expect(out[1]).toBe('select 2;')
  })
})

describe('splitJsCommands', () => {
  it('splits on top-level semicolons', () => {
    expect(splitJsCommands('db.users.find();db.orders.find()')).toEqual([
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

  it('splits on CRLF before db.', () => {
    expect(texts(splitJsCommands('db.x.find()\r\ndb.y.find()'))).toEqual([
      'db.x.find()',
      'db.y.find()'
    ])
  })

  it('does NOT split a chained modifier continuation line', () => {
    const src = 'db.users.find({ active: true })\n  .sort({ name: 1 })\n  .limit(5)'
    expect(texts(splitJsCommands(src))).toEqual([src])
  })

  it('does not split on newline when the next line is not db.', () => {
    expect(texts(splitJsCommands('db.users.find(\n)\n'))).toEqual(['db.users.find(\n)'])
  })

  it('a title comment between semicolon-less commands stays out of both texts', () => {
    const src = '// count users\ndb.users.find().count()\n\n// count orders\ndb.orders.find().count()'
    expect(texts(splitJsCommands(src))).toEqual([
      'db.users.find().count()',
      'db.orders.find().count()'
    ])
  })

  it('a comment line before a chained continuation does not split', () => {
    const src = 'db.users.find()\n// just the first page\n  .limit(5)'
    expect(texts(splitJsCommands(src))).toEqual([src])
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
    expect(texts(splitJsCommands('db.foo.aggregate([{ $match: { a: 1 } }]);db.bar.find()'))).toEqual([
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
    expect(texts(splitJsCommands('/a;b/.test(s); db.users.find()'))).toEqual([
      '/a;b/.test(s);',
      'db.users.find()'
    ])
  })

  it('skips regex literals with flags and char classes', () => {
    expect(texts(splitJsCommands('db.users.find({ name: /[/;]x/gi })\ndb.orders.find()'))).toEqual([
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
    expect(texts(splitJsCommands('db.users.find() // trailing ; note\ndb.orders.find()'))).toEqual([
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
  const source = 'select 1; select 2'
  const stmts = pg(source)

  it('returns the statement containing the offset', () => {
    expect(statementAt(source, stmts, 3)?.text).toBe('select 1;')
    expect(statementAt(source, stmts, 12)?.text).toBe('select 2')
  })

  it('a cursor right after a just-typed statement picks that statement', () => {
    // Offset 9 is just past `select 1;` on the same line.
    expect(statementAt(source, stmts, 9)?.text).toBe('select 1;')
  })

  it('a same-line trailing comment belongs to the statement before it', () => {
    const src = 'select 1; -- one\nselect 2'
    const out = pg(src)
    expect(statementAt(src, out, src.indexOf('one'))?.text).toBe('select 1;')
  })

  it("a title comment's line belongs to the statement it titles", () => {
    const src = '-- count users\nselect count(*) from users;\n\n-- count orders\nselect count(*) from orders;'
    const out = pg(src)
    expect(statementAt(src, out, src.indexOf('count orders'))?.text).toBe(
      'select count(*) from orders;'
    )
  })

  it('a blank line between statements belongs to the next statement', () => {
    const src = 'select 1;\n\nselect 2'
    const out = pg(src)
    expect(statementAt(src, out, 10)?.text).toBe('select 2')
  })

  it("a title comment's line belongs to the command it titles (mongo)", () => {
    const src = 'db.users.find().count()\n\n// count orders\ndb.orders.find().count()'
    const out = splitJsCommands(src)
    expect(statementAt(src, out, src.indexOf('count orders'))?.text).toBe(
      'db.orders.find().count()'
    )
  })

  it('clamps offsets before the first statement to it', () => {
    const src = '  select 1; select 2'
    const padded = pg(src)
    expect(padded[0].start).toBe(2)
    expect(statementAt(src, padded, 0)?.text).toBe('select 1;')
  })

  it('an offset at or past the end picks the last statement', () => {
    expect(statementAt(source, stmts, 18)?.text).toBe('select 2')
    expect(statementAt(source, stmts, 999)?.text).toBe('select 2')
  })

  it('returns null for no statements', () => {
    expect(statementAt('', [], 0)).toBeNull()
  })
})

describe('isTransactionControl', () => {
  it('matches transaction-control heads, any case', () => {
    for (const sql of [
      'BEGIN;',
      'begin',
      'start transaction;',
      'COMMIT;',
      'rollback',
      'end;', // pg COMMIT alias
      'SAVEPOINT sp1;',
      'release savepoint sp1;',
      'ABORT;', // pg ROLLBACK alias
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED;',
      'set session transaction read only;',
      'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;', // persists on the pooled session
      'SET autocommit = 0;',
      'SET @@autocommit = 0;', // mysql system-variable spellings of the same poison
      'set @@session.autocommit = 0;',
      'SET @@GLOBAL.autocommit = 1;'
    ]) {
      expect(isTransactionControl(sql), sql).toBe(true)
    }
  })

  it('looks through leading comments and whitespace', () => {
    expect(isTransactionControl('-- open the txn\nBEGIN;')).toBe(true)
    expect(isTransactionControl('/* multi\n line */ commit;')).toBe(true)
    expect(isTransactionControl('  # mysql comment\n  rollback')).toBe(true)
  })

  it('does not match ordinary statements', () => {
    for (const sql of [
      'select 1;',
      'select begin_date from t;', // word-boundary: begin_… is not BEGIN
      'update t set committed = true;',
      "insert into log values ('rollback requested');",
      'SET search_path TO app;', // plain SET is not transaction control
      'SET @@max_execution_time = 1000;', // …nor are other @@ system variables
      'START REPLICA;', // mysql admin statements, not START TRANSACTION
      'start slave;',
      'create function f() returns int as $$ begin return 1; end $$ language plpgsql;',
      '-- commit notes\nselect 2'
    ]) {
      expect(isTransactionControl(sql), sql).toBe(false)
    }
  })
})
