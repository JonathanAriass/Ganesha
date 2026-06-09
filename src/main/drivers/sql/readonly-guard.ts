const READ_LEADING = new Set(['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'DESCRIBE', 'DESC', 'VALUES', 'TABLE'])
const WRITE_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|TRUNCATE|DROP|CREATE|ALTER|RENAME|GRANT|REVOKE|REPLACE|CALL|EXEC|EXECUTE|DO|VACUUM|REINDEX|CLUSTER|LOCK|COPY|LOAD|IMPORT|ATTACH|DETACH|SET|RESET)\b/i

/** Remove block and line comments. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** Split into trimmed, non-empty statements on semicolons (best-effort, comments stripped first). */
export function splitStatements(sql: string): string[] {
  return stripSqlComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function leadingKeyword(stmt: string): string | null {
  const m = stmt.match(/^[A-Za-z]+/)
  return m ? m[0].toUpperCase() : null
}

/** True only if EVERY statement is a pure read (safe on a read-only connection). */
export function isSqlReadOnly(sql: string): boolean {
  for (const stmt of splitStatements(sql)) {
    const kw = leadingKeyword(stmt)
    if (!kw || !READ_LEADING.has(kw)) return false
    // WITH ... (data-modifying CTE) and EXPLAIN ANALYZE actually perform writes.
    if ((kw === 'WITH' || kw === 'EXPLAIN') && WRITE_RE.test(stmt)) return false
    if (kw === 'EXPLAIN' && /\bANALYZE\b/i.test(stmt)) return false
    // SELECT ... INTO creates a table (Postgres) or writes a file (MySQL INTO OUTFILE/DUMPFILE).
    // Reachable under a leading WITH too: WITH cte AS (...) SELECT ... INTO t FROM cte.
    if ((kw === 'SELECT' || kw === 'WITH') && /\bINTO\b/i.test(stmt)) return false
  }
  return true
}

/** Throw if a write/DDL statement is issued on a read-only connection. */
export function assertSqlWritable(sql: string, readOnly: boolean): void {
  if (readOnly && !isSqlReadOnly(sql)) {
    throw new Error('This connection is read-only — only SELECT/read statements are allowed.')
  }
}
