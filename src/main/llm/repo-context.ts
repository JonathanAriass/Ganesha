/** Retrieval that grounds the assistant in the linked repo's code. Pure — the directory walk and
 *  file reads (in repo-scan.ts) are injected, so the matching/ranking/budgeting is unit-testable. */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function camelCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}

function singularize(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y' // categories → category
  if (/(sses|ses|xes|ches|shes)$/.test(s)) return s.slice(0, -2) // addresses → address
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1) // users → user
  return s
}

/** Strip a leading ordering prefix like `02_` / `115_` (migration-number conventions). `02_users` →
 *  `users`; names without such a prefix (incl. `3d_models`, where digits aren't a `_`/`-`-delimited
 *  prefix) are returned unchanged. */
function stripOrderingPrefix(name: string): string {
  return name.replace(/^\d+[_-]/, '')
}

/** Name variants a table maps to in code: the raw name, its singular, and CamelCase of both — so
 *  `users` finds the model `User.php` AND the migration `..._create_users_table.php` (Laravel /
 *  Doctrine naming). When the table carries an ordering prefix (`02_users`), the prefix-stripped
 *  forms are added too, so it still matches an unprefixed `User.php` / `..._create_users_table.php`. */
export function tableNameVariants(table: string): string[] {
  const t = table.toLowerCase()
  const base = stripOrderingPrefix(t)
  const out: string[] = []
  for (const n of base === t ? [t] : [t, base]) {
    const sing = singularize(n)
    out.push(n, sing, camelCase(n), camelCase(sing))
  }
  return [...new Set(out)]
}

/** The connection's KNOWN tables that appear (whole-word, case-insensitive) in the user's message
 *  or the open query's SQL. Matching real table names avoids noisy free-text guessing. */
export function relevantTables(message: string, queryText: string, knownTables: string[]): string[] {
  const hay = `${message}\n${queryText}`.toLowerCase()
  const out: string[] = []
  for (const t of knownTables) {
    const lower = t.toLowerCase()
    const base = stripOrderingPrefix(lower)
    // Match the raw name (e.g. an open query that says `02_users`) OR the prefix-stripped name (a
    // user who naturally writes "users"). Singular/plural is intentionally NOT folded here — that
    // would make "product" match the table `products` and flood retrieval with near-misses.
    const forms = base === lower ? [lower] : [lower, base]
    if (forms.some((f) => new RegExp(`\\b${escapeRegex(f)}\\b`).test(hay))) out.push(t)
  }
  return out
}

export interface RankedFile {
  path: string
  table: string
  score: number
}

const MODEL_DIRS = ['/models/', '/model/', '/entity/', '/entities/']
const MIGRATION_DIRS = ['/migrations/', '/migrate/']

/** Rank repo file PATHS by relevance to the tables (no reads): a file whose basename contains a
 *  table-name variant scores high, boosted by model/entity (+25) or migration (+20) directories and
 *  a `.php` (+5) / `.sql` (+8) extension. Files with no name hit are dropped. */
export function rankRepoFiles(files: string[], tables: string[]): RankedFile[] {
  const tv = tables.map((t) => ({ table: t, variants: tableNameVariants(t).map((v) => v.toLowerCase()) }))
  const ranked: RankedFile[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    for (const { table, variants } of tv) {
      if (!variants.some((v) => base.includes(v))) continue
      let score = 100
      if (MODEL_DIRS.some((d) => lower.includes(d))) score += 25
      else if (MIGRATION_DIRS.some((d) => lower.includes(d))) score += 20
      if (base.endsWith('.php')) score += 5
      else if (base.endsWith('.sql')) score += 8
      ranked.push({ path, table, score })
      break // one entry per file (its best table)
    }
  }
  return ranked.sort((a, b) => b.score - a.score)
}

/** A bounded snippet of a file: the whole thing if small, else a window around the first table
 *  mention (so the table definition, not just the file head, is captured). */
function snippetFor(content: string, tables: string[], perFile: number): string {
  if (content.length <= perFile) return content
  const variants = tables.flatMap(tableNameVariants).map((v) => v.toLowerCase())
  const lower = content.toLowerCase()
  let idx = -1
  for (const v of variants) {
    const i = lower.indexOf(v)
    if (i >= 0 && (idx === -1 || i < idx)) idx = i
  }
  const start = idx <= perFile ? 0 : Math.max(0, idx - Math.floor(perFile / 4))
  const slice = content.slice(start, start + perFile)
  return `${start > 0 ? '…' : ''}${slice}${start + perFile < content.length ? '…' : ''}`
}

export interface RepoContextInput {
  tables: string[]
  ranked: RankedFile[]
  readFile: (path: string) => string | null
  budget?: number
  perFile?: number
  maxFiles?: number
}

/** One file that made it into the prompt: its repo-relative path, the table that pulled it in, and
 *  the exact snippet injected (windowed if the file was large). Surfaced to the UI so the user can
 *  inspect precisely what grounded an answer. */
export interface UsedFile {
  path: string
  table: string
  snippet: string
}

/** Read the top-ranked files (injected `readFile`), window each to the table mention, and assemble a
 *  budgeted, labeled code block for the system prompt. Returns the prompt text plus the per-file
 *  blocks used (for the transparency line + its expandable detail). Empty when no tables/files apply. */
export function buildRepoContext(input: RepoContextInput): { text: string; used: UsedFile[] } {
  const { tables, ranked, readFile, budget = 8000, perFile = 2400, maxFiles = 5 } = input
  if (tables.length === 0 || ranked.length === 0) return { text: '', used: [] }

  const used: UsedFile[] = []
  const blocks: string[] = []
  let total = 0
  const seen = new Set<string>()
  for (const { path, table } of ranked) {
    if (used.length >= maxFiles || total >= budget) break
    if (seen.has(path)) continue
    seen.add(path)
    const content = readFile(path)
    if (content == null) continue
    const snippet = snippetFor(content, tables, perFile)
    const block = `// ${path}\n${snippet}`
    if (total + block.length > budget && used.length > 0) break // always keep at least one file
    blocks.push(block)
    used.push({ path, table, snippet })
    total += block.length
  }
  if (used.length === 0) return { text: '', used: [] }
  const text =
    'Relevant code from the linked repository (for context; prefer the live schema for exact column names):\n\n' +
    blocks.join('\n\n')
  return { text, used }
}
