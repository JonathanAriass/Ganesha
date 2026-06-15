# Local LLM SQL Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully-local, schema-aware chat assistant: download a GGUF model, open a dockable panel, and get query suggestions you can insert into a new tab.

**Architecture:** `node-llama-cpp` (embedded llama.cpp) runs in the main process behind an `LlmService`. The renderer drives it over IPC; tokens stream back over a new main→renderer push channel. Suggestions are grounded with the active connection's schema. Conversations persist in sqlite.

**Tech Stack:** Electron + React + TypeScript, electron-vite, better-sqlite3, `node-llama-cpp` (new), vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-llm-assistant-design.md`

---

## Canonical signatures (use verbatim across tasks)

```ts
// src/shared/domain.ts
interface LocalModel { id: string; name: string; path: string; sizeBytes: number }
interface CatalogModel { id: string; name: string; uri: string; sizeLabel: string; description: string }
interface LlmConversation { id: string; connectionId: string; title: string; createdAt: number; updatedAt: number }
interface LlmMessage { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; createdAt: number }

// src/main/llm/schema-context.ts (pure)
buildSchemaContext(dialect: string, objects: { object: DbObject; columns: ColumnInfo[] }[], maxChars?: number): string

// src/renderer/src/lib/llm-blocks.ts (pure)
interface CodeBlock { lang: string; code: string }
extractCodeBlocks(markdown: string): CodeBlock[]

// src/main/llm/catalog.ts
const MODEL_CATALOG: CatalogModel[]

// src/main/llm/models.ts  (modelsDir injected for tests)
listLocalModels(modelsDir: string): LocalModel[]
deleteLocalModel(modelsDir: string, id: string): void
// download uses node-llama-cpp; see Task 7

// src/main/llm/engine.ts
class LlmEngine {
  load(modelPath: string): Promise<void>
  isLoaded(): boolean
  generate(systemPrompt: string, history: LlmMessage[], userText: string,
           onChunk: (s: string) => void, signal: AbortSignal): Promise<string>
  unload(): Promise<void>
}

// src/main/persistence/llm.ts
createConversation(db, connectionId, title, now): LlmConversation
listConversations(db, connectionId): LlmConversation[]
deleteConversation(db, id): void
addMessage(db, conversationId, role, content, now): LlmMessage
listMessages(db, conversationId): LlmMessage[]
touchConversation(db, id, now): void

// src/main/persistence/paths.ts
getModelsDir(): string

// src/main/persistence/settings.ts
getSetting(db, key): string | null   // exported reader (new)
```

---

### Task 1: Spike — prove `node-llama-cpp` loads and generates

A spike, not TDD: de-risk the ESM-only + native-binary integration before building on it.

**Files:**
- Modify: `package.json` (dep)
- Create (throwaway): `scripts/llm-spike.mjs`

- [ ] **Step 1: Install**

Run: `npm i node-llama-cpp@^3`
Expected: installs with prebuilt binaries.

- [ ] **Step 2: Pull a tiny model for the spike**

Run: `npx --yes node-llama-cpp pull --dir ./.spike-models hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M`
Expected: a `.gguf` file downloads under `./.spike-models`.

- [ ] **Step 3: Generate one response**

Create `scripts/llm-spike.mjs`:

```js
import { getLlama, LlamaChatSession } from 'node-llama-cpp'
import { readdirSync } from 'fs'
import { join } from 'path'

const dir = './.spike-models'
const file = readdirSync(dir).find((f) => f.endsWith('.gguf'))
const llama = await getLlama()
const model = await llama.loadModel({ modelPath: join(dir, file) })
const ctx = await model.createContext()
const session = new LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: 'You are a SQL assistant.' })
let out = ''
await session.prompt('Write a SQL query selecting all rows from users.', { onTextChunk: (c) => { out += c; process.stdout.write(c) } })
console.log('\n---\nGOT', out.length, 'chars')
await model.dispose()
```

Run: `node scripts/llm-spike.mjs`
Expected: streamed tokens, ends with `GOT <n> chars` (n > 0).

- [ ] **Step 4: Confirm the import strategy for the bundled main process**

`node-llama-cpp` is ESM-only and externalized by electron-vite. In the main process it MUST be loaded with a dynamic import. Verify this resolves from the built main bundle by adding a temporary line to `src/main/index.ts` inside `app.whenReady().then(...)`:

```ts
    import('node-llama-cpp').then((m) => console.log('node-llama-cpp loaded:', typeof m.getLlama)).catch((e) => console.error('LLM import failed', e))
```

Run: `npm run dev` (background) and check the main-process console shows `node-llama-cpp loaded: function`. Then REMOVE the temporary line.

- [ ] **Step 5: Record findings + commit the dep**

Add `.spike-models/` and `scripts/llm-spike.mjs` to `.gitignore` (throwaway). Commit only the dependency:

```bash
git add package.json package-lock.json .gitignore
git commit -m "build: add node-llama-cpp; spike confirms load + generation in dev"
```

If Step 4 fails (CJS require of ESM), the fix is: ensure `node-llama-cpp` stays in `dependencies` (externalized, not bundled) and is always reached via `await import(...)`, never `require`. Document the resolution in the commit body.

---

### Task 2: Domain types + paths + persistence

**Files:**
- Modify: `src/shared/domain.ts`, `src/main/persistence/paths.ts`, `src/main/persistence/db.ts`, `src/main/persistence/settings.ts`
- Create: `src/main/persistence/llm.ts`, `src/main/persistence/llm.test.ts`

- [ ] **Step 1: Add the types**

In `src/shared/domain.ts` (end of file):

```ts
export interface LocalModel { id: string; name: string; path: string; sizeBytes: number }
export interface CatalogModel { id: string; name: string; uri: string; sizeLabel: string; description: string }
export interface LlmConversation { id: string; connectionId: string; title: string; createdAt: number; updatedAt: number }
export interface LlmMessage { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; createdAt: number }
```

- [ ] **Step 2: `getModelsDir` + exported `getSetting`**

In `src/main/persistence/paths.ts`:

```ts
import { mkdirSync } from 'fs' // already imported alongside others — ensure mkdirSync is in the import

/** Directory holding downloaded GGUF models, under the current data dir. */
export function getModelsDir(): string {
  const dir = join(getDataDir(), 'models')
  mkdirSync(dir, { recursive: true })
  return dir
}
```

In `src/main/persistence/settings.ts`, export the reader (rename usage stays):

```ts
export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}
```

(Leave the private `readSetting` or replace its body with `return getSetting(db, key)`.)

- [ ] **Step 3: Tables**

In `src/main/persistence/db.ts`, inside the `db.exec(...)` block (after `session_tabs`):

```sql
    CREATE TABLE IF NOT EXISTS llm_conversations (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_conv ON llm_conversations(connection_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS llm_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES llm_conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_msg ON llm_messages(conversation_id, created_at);
```

- [ ] **Step 4: Write the failing persistence test**

Create `src/main/persistence/llm.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type DB } from './db'
import { createConnection } from './connections'
import { createConversation, listConversations, deleteConversation, addMessage, listMessages, touchConversation } from './llm'
import type { ConnectionInput } from '../../shared/domain'

const conn: ConnectionInput = {
  type: 'postgres', name: 'p', color: '#000', host: 'h', port: 1, username: 'u',
  database: 'd', ssl: false, readOnly: false, authSource: '', replicaSet: '', ssh: null
}
let db: DB
beforeEach(() => { db = new Database(':memory:'); migrate(db) })

describe('llm persistence', () => {
  it('creates and lists conversations per connection, newest first', () => {
    const c = createConnection(db, conn, 1)
    const a = createConversation(db, c.id, 'first', 10)
    const b = createConversation(db, c.id, 'second', 20)
    const list = listConversations(db, c.id)
    expect(list.map((x) => x.id)).toEqual([b.id, a.id])
    expect(list[0].title).toBe('second')
  })

  it('stores and reads messages in chronological order', () => {
    const c = createConnection(db, conn, 1)
    const conv = createConversation(db, c.id, 't', 1)
    addMessage(db, conv.id, 'user', 'hi', 2)
    addMessage(db, conv.id, 'assistant', 'hello', 3)
    expect(listMessages(db, conv.id).map((m) => [m.role, m.content])).toEqual([['user', 'hi'], ['assistant', 'hello']])
  })

  it('touch bumps updated_at for ordering', () => {
    const c = createConnection(db, conn, 1)
    const a = createConversation(db, c.id, 'a', 1)
    createConversation(db, c.id, 'b', 2)
    touchConversation(db, a.id, 99)
    expect(listConversations(db, c.id)[0].id).toBe(a.id)
  })

  it('cascades: deleting a conversation removes its messages; deleting the connection removes conversations', () => {
    const c = createConnection(db, conn, 1)
    const conv = createConversation(db, c.id, 't', 1)
    addMessage(db, conv.id, 'user', 'x', 2)
    deleteConversation(db, conv.id)
    expect(listMessages(db, conv.id)).toEqual([])
    const conv2 = createConversation(db, c.id, 't2', 3)
    db.prepare('DELETE FROM connections WHERE id = ?').run(c.id)
    expect(listConversations(db, c.id)).toEqual([])
    expect(listMessages(db, conv2.id)).toEqual([])
  })
})
```

- [ ] **Step 5: Run — expect failure**

Run: `npx vitest run src/main/persistence/llm.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement `src/main/persistence/llm.ts`**

```ts
import { randomUUID } from 'crypto'
import type { DB } from './db'
import type { LlmConversation, LlmMessage } from '../../shared/domain'

export function createConversation(db: DB, connectionId: string, title: string, now: number): LlmConversation {
  const id = randomUUID()
  db.prepare(`INSERT INTO llm_conversations (id, connection_id, title, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, connectionId, title, now, now)
  return { id, connectionId, title, createdAt: now, updatedAt: now }
}

export function listConversations(db: DB, connectionId: string): LlmConversation[] {
  const rows = db.prepare(
    `SELECT id, connection_id, title, created_at, updated_at FROM llm_conversations
     WHERE connection_id = ? ORDER BY updated_at DESC, created_at DESC`
  ).all(connectionId) as Array<{ id: string; connection_id: string; title: string; created_at: number; updated_at: number }>
  return rows.map((r) => ({ id: r.id, connectionId: r.connection_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }))
}

export function deleteConversation(db: DB, id: string): void {
  db.prepare('DELETE FROM llm_conversations WHERE id = ?').run(id)
}

export function touchConversation(db: DB, id: string, now: number): void {
  db.prepare('UPDATE llm_conversations SET updated_at = ? WHERE id = ?').run(now, id)
}

export function addMessage(db: DB, conversationId: string, role: 'user' | 'assistant', content: string, now: number): LlmMessage {
  const id = randomUUID()
  db.prepare(`INSERT INTO llm_messages (id, conversation_id, role, content, created_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, conversationId, role, content, now)
  return { id, conversationId, role, content, createdAt: now }
}

export function listMessages(db: DB, conversationId: string): LlmMessage[] {
  const rows = db.prepare(
    `SELECT id, conversation_id, role, content, created_at FROM llm_messages
     WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`
  ).all(conversationId) as Array<{ id: string; conversation_id: string; role: string; content: string; created_at: number }>
  return rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, role: r.role as 'user' | 'assistant', content: r.content, createdAt: r.created_at }))
}
```

- [ ] **Step 7: Run — expect pass; then full suite + typecheck**

Run: `npx vitest run src/main/persistence/llm.test.ts` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 8: Commit**

```bash
git add src/shared/domain.ts src/main/persistence/paths.ts src/main/persistence/settings.ts src/main/persistence/db.ts src/main/persistence/llm.ts src/main/persistence/llm.test.ts
git commit -m "feat: LLM domain types + models dir + conversation/message persistence"
```

---

### Task 3: Schema-context builder (pure)

**Files:**
- Create: `src/main/llm/schema-context.ts`, `src/main/llm/schema-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildSchemaContext } from './schema-context'
import type { DbObject, ColumnInfo } from '../../shared/schema'

const t = (name: string, cols: ColumnInfo[]): { object: DbObject; columns: ColumnInfo[] } => ({
  object: { schema: 'public', name, kind: 'table' }, columns: cols
})
const col = (name: string, dataType: string, nullable = true): ColumnInfo => ({ name, dataType, nullable })

describe('buildSchemaContext', () => {
  it('emits a dialect line and a compact table summary', () => {
    const out = buildSchemaContext('postgres', [t('users', [col('id', 'int8', false), col('email', 'text')])])
    expect(out).toMatch(/postgres/i)
    expect(out).toContain('users')
    expect(out).toContain('id')
    expect(out).toContain('int8')
    expect(out).toContain('email')
  })

  it('marks not-null columns and qualifies non-public schemas', () => {
    const out = buildSchemaContext('postgres', [
      { object: { schema: 'app', name: 'orders', kind: 'table' }, columns: [col('total', 'numeric', false)] }
    ])
    expect(out).toContain('app.orders')
    expect(out).toMatch(/total[^\n]*not null/i)
  })

  it('truncates to the char budget with a marker rather than dumping everything', () => {
    const many = Array.from({ length: 200 }, (_, i) => t(`tbl${i}`, [col('c', 'int')]))
    const out = buildSchemaContext('mysql', many, 500)
    expect(out.length).toBeLessThanOrEqual(600) // budget + the marker line
    expect(out).toMatch(/truncated/i)
  })

  it('handles an empty schema without throwing', () => {
    expect(buildSchemaContext('postgres', [])).toMatch(/no tables/i)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/llm/schema-context.test.ts` → FAIL

- [ ] **Step 3: Implement**

```ts
import type { DbObject, ColumnInfo } from '../../shared/schema'

const DEFAULT_BUDGET = 6000

/** Render the connection schema as a compact, dialect-tagged summary for the
 *  system prompt. Truncates to a char budget so a huge schema can't blow the
 *  model's context window. */
export function buildSchemaContext(
  dialect: string,
  objects: { object: DbObject; columns: ColumnInfo[] }[],
  maxChars = DEFAULT_BUDGET
): string {
  const header = `Database dialect: ${dialect}.`
  if (objects.length === 0) return `${header}\n(no tables found)`

  const lines: string[] = []
  for (const { object, columns } of objects) {
    const qualified = object.schema && object.schema !== 'public' ? `${object.schema}.${object.name}` : object.name
    const cols = columns.map((c) => `${c.name} ${c.dataType}${c.nullable ? '' : ' not null'}`).join(', ')
    lines.push(`${qualified}(${cols})`)
  }

  let body = ''
  let truncated = false
  for (const line of lines) {
    if (header.length + body.length + line.length + 1 > maxChars) { truncated = true; break }
    body += line + '\n'
  }
  const marker = truncated ? '… (schema truncated)\n' : ''
  return `${header}\nTables:\n${body}${marker}`.trimEnd()
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/main/llm/schema-context.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/llm/schema-context.ts src/main/llm/schema-context.test.ts
git commit -m "feat: pure schema-context builder for LLM grounding"
```

---

### Task 4: Code-block extraction (pure renderer lib)

**Files:**
- Create: `src/renderer/src/lib/llm-blocks.ts`, `src/renderer/src/lib/llm-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { extractCodeBlocks } from './llm-blocks'

describe('extractCodeBlocks', () => {
  it('pulls a fenced sql block with its language', () => {
    const md = 'Here:\n```sql\nSELECT 1;\n```\nDone.'
    expect(extractCodeBlocks(md)).toEqual([{ lang: 'sql', code: 'SELECT 1;' }])
  })
  it('returns multiple blocks in order, defaulting a missing language to ""', () => {
    const md = '```js\ndb.users.find({})\n```\ntext\n```\nplain\n```'
    expect(extractCodeBlocks(md)).toEqual([
      { lang: 'js', code: 'db.users.find({})' },
      { lang: '', code: 'plain' }
    ])
  })
  it('returns [] when there are no fences', () => {
    expect(extractCodeBlocks('just prose')).toEqual([])
  })
  it('ignores an unterminated fence', () => {
    expect(extractCodeBlocks('```sql\nSELECT 1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/renderer/src/lib/llm-blocks.test.ts` → FAIL

- [ ] **Step 3: Implement**

```ts
export interface CodeBlock { lang: string; code: string }

/** Extract fenced ``` code blocks from markdown. Only closed fences count. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  // ```lang\n …code… \n``` — non-greedy body, language is the first fence word.
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    blocks.push({ lang: m[1].trim(), code: m[2].replace(/\n$/, '') })
  }
  return blocks
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/renderer/src/lib/llm-blocks.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/llm-blocks.ts src/renderer/src/lib/llm-blocks.test.ts
git commit -m "feat: pure fenced-code-block extractor for assistant suggestions"
```

---

### Task 5: Curated model catalog (pure data)

**Files:**
- Create: `src/main/llm/catalog.ts`, `src/main/llm/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { MODEL_CATALOG } from './catalog'

describe('MODEL_CATALOG', () => {
  it('offers a few well-formed entries', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(2)
    for (const m of MODEL_CATALOG) {
      expect(m.id).toMatch(/.+/)
      expect(m.uri).toMatch(/^hf:/) // Hugging Face URI node-llama-cpp understands
      expect(m.name).toMatch(/.+/)
      expect(m.sizeLabel).toMatch(/.+/)
    }
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length) // unique ids
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/llm/catalog.test.ts` → FAIL

- [ ] **Step 3: Implement**

```ts
import type { CatalogModel } from '../../shared/domain'

/** A small curated set of local, SQL-capable instruct models (GGUF, quantized).
 *  Advanced users can also paste any `hf:org/repo:quant` URI in the UI. */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'qwen2.5-coder-1.5b-q4',
    name: 'Qwen2.5 Coder 1.5B (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~1.1 GB',
    description: 'Smallest; fast on any machine. Good for simple queries.'
  },
  {
    id: 'qwen2.5-coder-7b-q4',
    name: 'Qwen2.5 Coder 7B (Q4_K_M)',
    uri: 'hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~4.7 GB',
    description: 'Best quality/size balance for SQL. Needs ~8 GB free RAM.'
  },
  {
    id: 'llama3.1-8b-q4',
    name: 'Llama 3.1 8B Instruct (Q4_K_M)',
    uri: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M',
    sizeLabel: '~4.9 GB',
    description: 'General-purpose; strong reasoning. Needs ~8 GB free RAM.'
  }
]
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/main/llm/catalog.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/llm/catalog.ts src/main/llm/catalog.test.ts
git commit -m "feat: curated GGUF model catalog"
```

---

### Task 6: Model manager — list / delete (FS, tested) + download/active wiring

**Files:**
- Create: `src/main/llm/models.ts`, `src/main/llm/models.test.ts`

- [ ] **Step 1: Write the failing test (list + delete over a temp dir)**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listLocalModels, deleteLocalModel } from './models'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'models-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('local models', () => {
  it('lists only .gguf files with id=filename and their size', () => {
    writeFileSync(join(dir, 'a.gguf'), 'xxxx')
    writeFileSync(join(dir, 'notes.txt'), 'ignore me')
    const models = listLocalModels(dir)
    expect(models.map((m) => m.id)).toEqual(['a.gguf'])
    expect(models[0].name).toBe('a')
    expect(models[0].sizeBytes).toBe(4)
    expect(models[0].path).toBe(join(dir, 'a.gguf'))
  })

  it('deletes a model by id and refuses to escape the dir', () => {
    writeFileSync(join(dir, 'a.gguf'), 'x')
    deleteLocalModel(dir, 'a.gguf')
    expect(existsSync(join(dir, 'a.gguf'))).toBe(false)
    expect(() => deleteLocalModel(dir, '../escape')).toThrow(/invalid model id/i)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/main/llm/models.test.ts` → FAIL

- [ ] **Step 3: Implement `src/main/llm/models.ts`**

```ts
import { readdirSync, statSync, unlinkSync } from 'fs'
import { join, basename, extname } from 'path'
import type { LocalModel, CatalogModel } from '../../shared/domain'

export function listLocalModels(modelsDir: string): LocalModel[] {
  let entries: string[] = []
  try { entries = readdirSync(modelsDir) } catch { return [] }
  return entries
    .filter((f) => f.endsWith('.gguf'))
    .map((f) => {
      const path = join(modelsDir, f)
      return { id: f, name: basename(f, extname(f)), path, sizeBytes: statSync(path).size }
    })
}

/** id is a bare filename; reject anything that would escape modelsDir. */
export function deleteLocalModel(modelsDir: string, id: string): void {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) throw new Error(`Invalid model id: ${id}`)
  unlinkSync(join(modelsDir, id))
}

/** Download a catalog/URI model into modelsDir, reporting progress. Uses
 *  node-llama-cpp's downloader (dynamic import — ESM-only). Returns the file path. */
export async function downloadModel(
  modelsDir: string,
  uri: string,
  onProgress: (receivedBytes: number, totalBytes: number) => void
): Promise<string> {
  const { createModelDownloader } = await import('node-llama-cpp')
  const downloader = await createModelDownloader({
    modelUri: uri,
    dirPath: modelsDir,
    onProgress: ({ downloadedSize, totalSize }) => onProgress(downloadedSize, totalSize)
  })
  return downloader.download()
}

export type { CatalogModel }
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/main/llm/models.test.ts` → PASS (download is native; covered by the Task 1 spike + the manual smoke in Task 12)

- [ ] **Step 5: Commit**

```bash
git add src/main/llm/models.ts src/main/llm/models.test.ts
git commit -m "feat: local model list/delete (tested) + downloader wrapper"
```

---

### Task 7: Inference engine (native, thin)

**Files:**
- Create: `src/main/llm/engine.ts`

Not unit-tested (heavy native dep) — kept thin; verified by typecheck + the Task 12 smoke. Concrete code, no placeholders.

- [ ] **Step 1: Implement `src/main/llm/engine.ts`**

```ts
import type { LlmMessage } from '../../shared/domain'

// node-llama-cpp is ESM-only + native; loaded via dynamic import so the bundled
// main process never tries to `require` it. Types are intentionally loose here.
/* eslint-disable @typescript-eslint/no-explicit-any */

export class LlmEngine {
  private llama: any = null
  private model: any = null
  private modelPath: string | null = null

  async load(modelPath: string): Promise<void> {
    if (this.modelPath === modelPath && this.model) return
    await this.unload()
    const { getLlama } = await import('node-llama-cpp')
    this.llama = this.llama ?? (await getLlama())
    this.model = await this.llama.loadModel({ modelPath })
    this.modelPath = modelPath
  }

  isLoaded(): boolean {
    return this.model !== null
  }

  /** Run one turn. A fresh context+session per call keeps state simple; history
   *  is replayed from sqlite each time. Streams via onChunk; abortable. */
  async generate(
    systemPrompt: string,
    history: LlmMessage[],
    userText: string,
    onChunk: (s: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.model) throw new Error('No model loaded')
    const { LlamaChatSession } = await import('node-llama-cpp')
    const context = await this.model.createContext()
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt })
      // Replay prior turns so the model has conversation context.
      for (let i = 0; i + 1 < history.length; i += 2) {
        if (history[i].role === 'user' && history[i + 1]?.role === 'assistant') {
          await session.prompt(history[i].content, { /* prime */ })
        }
      }
      let full = ''
      await session.prompt(userText, { onTextChunk: (c: string) => { full += c; onChunk(c) }, signal })
      return full
    } finally {
      await context.dispose()
    }
  }

  async unload(): Promise<void> {
    if (this.model) { await this.model.dispose(); this.model = null; this.modelPath = null }
  }
}
```

Note for the implementer: history replay above is a simple approach; if it proves slow, replace the loop with constructing the session once and feeding prior turns via the library's chat-history API. Keep the `generate` signature unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → clean

- [ ] **Step 3: Commit**

```bash
git add src/main/llm/engine.ts
git commit -m "feat: LLM inference engine (load/generate/stream/cancel) over node-llama-cpp"
```

---

### Task 8: IPC + preload + api (incl. streaming push channel)

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`

No unit tests (IPC wiring; logic already covered). Verify via typecheck + the Task 12 smoke.

- [ ] **Step 1: Channel types — `src/shared/ipc.ts`**

Add to `IpcChannels`:

```ts
  'llm.models.list': { req: void; res: { downloaded: LocalModel[]; catalog: CatalogModel[]; activeModelId: string | null } }
  'llm.models.download': { req: { uri: string }; res: null }
  'llm.models.delete': { req: { id: string }; res: null }
  'llm.models.setActive': { req: { id: string }; res: null }
  'llm.conversations.list': { req: { connectionId: string }; res: LlmConversation[] }
  'llm.conversations.create': { req: { connectionId: string; title: string }; res: LlmConversation }
  'llm.conversations.delete': { req: { id: string }; res: null }
  'llm.messages.list': { req: { conversationId: string }; res: LlmMessage[] }
  'llm.chat.send': { req: { conversationId: string; connectionId: string; prompt: string }; res: { requestId: string } }
  'llm.chat.cancel': { req: { requestId: string }; res: null }
```

Add imports for `LocalModel, CatalogModel, LlmConversation, LlmMessage` to the existing domain import. Push channels aren't part of `IpcChannels` (they're not invoke); define their payloads as exported types:

```ts
export interface LlmTokenEvent { requestId: string; chunk?: string; done?: boolean; error?: string }
export interface LlmDownloadEvent { uri: string; receivedBytes?: number; totalBytes?: number; done?: boolean; error?: string }
```

- [ ] **Step 2: api type — `src/shared/api.ts`**

```ts
  llm: {
    listModels(): Promise<IpcResult<'llm.models.list'>>
    downloadModel(uri: string): Promise<IpcResult<'llm.models.download'>>
    deleteModel(id: string): Promise<IpcResult<'llm.models.delete'>>
    setActiveModel(id: string): Promise<IpcResult<'llm.models.setActive'>>
    listConversations(connectionId: string): Promise<IpcResult<'llm.conversations.list'>>
    createConversation(connectionId: string, title: string): Promise<IpcResult<'llm.conversations.create'>>
    deleteConversation(id: string): Promise<IpcResult<'llm.conversations.delete'>>
    listMessages(conversationId: string): Promise<IpcResult<'llm.messages.list'>>
    send(conversationId: string, connectionId: string, prompt: string): Promise<IpcResult<'llm.chat.send'>>
    cancel(requestId: string): Promise<IpcResult<'llm.chat.cancel'>>
    onToken(cb: (e: LlmTokenEvent) => void): () => void
    onDownloadProgress(cb: (e: LlmDownloadEvent) => void): () => void
  }
```

Import `LlmTokenEvent, LlmDownloadEvent` from `./ipc`.

- [ ] **Step 3: preload — `src/preload/index.ts`**

```ts
  llm: {
    listModels: () => invoke('llm.models.list', undefined),
    downloadModel: (uri) => invoke('llm.models.download', { uri }),
    deleteModel: (id) => invoke('llm.models.delete', { id }),
    setActiveModel: (id) => invoke('llm.models.setActive', { id }),
    listConversations: (connectionId) => invoke('llm.conversations.list', { connectionId }),
    createConversation: (connectionId, title) => invoke('llm.conversations.create', { connectionId, title }),
    deleteConversation: (id) => invoke('llm.conversations.delete', { id }),
    listMessages: (conversationId) => invoke('llm.messages.list', { conversationId }),
    send: (conversationId, connectionId, prompt) => invoke('llm.chat.send', { conversationId, connectionId, prompt }),
    cancel: (requestId) => invoke('llm.chat.cancel', { requestId }),
    onToken: (cb) => {
      const l = (_e: unknown, payload: LlmTokenEvent) => cb(payload)
      ipcRenderer.on('llm:token', l)
      return () => ipcRenderer.removeListener('llm:token', l)
    },
    onDownloadProgress: (cb) => {
      const l = (_e: unknown, payload: LlmDownloadEvent) => cb(payload)
      ipcRenderer.on('llm:download', l)
      return () => ipcRenderer.removeListener('llm:download', l)
    }
  }
```

Import the event types at the top of preload: `import type { ChannelName, Req, IpcResult, LlmTokenEvent, LlmDownloadEvent } from '../shared/ipc'`.

- [ ] **Step 4: main handlers — `src/main/ipc.ts`**

Add imports:

```ts
import { LlmEngine } from './llm/engine'
import { MODEL_CATALOG } from './llm/catalog'
import { listLocalModels, deleteLocalModel, downloadModel } from './llm/models'
import { buildSchemaContext } from './llm/schema-context'
import * as llm from './persistence/llm'
import { getModelsDir } from './persistence/paths'
import { getSetting } from './persistence/settings'
import { randomUUID } from 'crypto'
import type { LlmTokenEvent, LlmDownloadEvent } from '../shared/ipc'

const engine = new LlmEngine()
const activeGenerations = new Map<string, AbortController>()
```

Inside `registerIpcHandlers()`, add the non-streaming handlers via the existing `handle()`:

```ts
  handle('llm.models.list', () => {
    const { db } = store()
    return ok({ downloaded: listLocalModels(getModelsDir()), catalog: MODEL_CATALOG, activeModelId: getSetting(db, 'llm.activeModel') })
  })
  handle('llm.models.delete', ({ id }) => { deleteLocalModel(getModelsDir(), id); return ok(null) })
  handle('llm.models.setActive', ({ id }) => { setSetting(store().db, 'llm.activeModel', id); return ok(null) })
  handle('llm.conversations.list', ({ connectionId }) => ok(llm.listConversations(store().db, connectionId)))
  handle('llm.conversations.create', ({ connectionId, title }) => ok(llm.createConversation(store().db, connectionId, title, now())))
  handle('llm.conversations.delete', ({ id }) => { llm.deleteConversation(store().db, id); return ok(null) })
  handle('llm.messages.list', ({ conversationId }) => ok(llm.listMessages(store().db, conversationId)))
  handle('llm.chat.cancel', ({ requestId }) => { activeGenerations.get(requestId)?.abort(); return ok(null) })
```

`setSetting` is already importable from `./persistence/secrets`? No — it's in `./persistence/settings`. Add to the settings import. Then the two streaming-aware handlers registered DIRECTLY (need `event.sender`):

```ts
  // Download: progress streamed to the renderer that asked.
  ipcMain.handle('llm.models.download', async (event, { uri }: { uri: string }) => {
    try {
      await downloadModel(getModelsDir(), uri, (receivedBytes, totalBytes) => {
        const ev: LlmDownloadEvent = { uri, receivedBytes, totalBytes }
        event.sender.send('llm:download', ev)
      })
      event.sender.send('llm:download', { uri, done: true } satisfies LlmDownloadEvent)
      return ok(null)
    } catch (e) {
      event.sender.send('llm:download', { uri, error: e instanceof Error ? e.message : String(e) } satisfies LlmDownloadEvent)
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  // Chat: persist the user message, stream tokens, persist the answer on done.
  ipcMain.handle('llm.chat.send', async (event, { conversationId, connectionId, prompt }: { conversationId: string; connectionId: string; prompt: string }) => {
    const { db, secrets } = store()
    const requestId = randomUUID()
    const send = (ev: LlmTokenEvent): void => { event.sender.send('llm:token', ev) }
    try {
      const activeModelId = getSetting(db, 'llm.activeModel')
      const models = listLocalModels(getModelsDir())
      const model = models.find((m) => m.id === activeModelId) ?? models[0]
      if (!model) throw new Error('No model downloaded — open the model manager to download one.')

      const config = conns.getConnection(db, connectionId)
      if (!config) throw new Error(`Connection not found: ${connectionId}`)

      // Build schema context through the tunnel-aware connect path.
      const driver = drivers.get(config.type)
      await connectStored(driver, config, secrets)
      const dbObjects = await driver.listObjects(config.id)
      const withCols = await Promise.all(dbObjects.map(async (o) => ({
        object: o, columns: await driver.describeObject(config.id, { schema: o.schema, name: o.name }).catch(() => [])
      })))
      const systemPrompt =
        'You are a database query assistant. Recommend correct queries for the user\'s database. ' +
        'Return runnable queries in fenced code blocks (```sql or ```js for MongoDB). Be concise.\n\n' +
        buildSchemaContext(config.type, withCols)

      const history = llm.listMessages(db, conversationId)
      llm.addMessage(db, conversationId, 'user', prompt, now())
      llm.touchConversation(db, conversationId, now())

      await engine.load(model.path)
      const ac = new AbortController()
      activeGenerations.set(requestId, ac)
      // Fire-and-forget the stream; the invoke resolves immediately with the id.
      void engine.generate(systemPrompt, history, prompt, (chunk) => send({ requestId, chunk }), ac.signal)
        .then((full) => { llm.addMessage(db, conversationId, 'assistant', full, now()); send({ requestId, done: true }) })
        .catch((e) => send({ requestId, error: e instanceof Error ? e.message : String(e) }))
        .finally(() => activeGenerations.delete(requestId))

      return ok({ requestId })
    } catch (e) {
      send({ requestId, error: e instanceof Error ? e.message : String(e) })
      return err(e instanceof Error ? e.message : String(e))
    }
  })
```

Add `void engine.unload()` to the existing `will-quit`/`closeAllTunnels` path in `src/main/index.ts` is optional; the process exits anyway. Skip.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint` → clean (fix any missing imports, e.g. add `setSetting` to the settings import line).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat: LLM IPC — models, conversations, schema-grounded streaming chat"
```

---

### Task 9: Renderer hooks + streaming subscription

**Files:**
- Modify: `src/renderer/src/lib/hooks.ts`

- [ ] **Step 1: Implement hooks**

Add (using the existing `unwrap`, `useQuery`, `useMutation`, `useQueryClient` already imported):

```ts
export function useLlmModels() {
  return useQuery({ queryKey: ['llm', 'models'], queryFn: () => window.api.llm.listModels().then(unwrap), retry: false })
}
export function useLlmConversations(connectionId: string | null) {
  return useQuery({
    queryKey: ['llm', 'conversations', connectionId],
    queryFn: () => window.api.llm.listConversations(connectionId!).then(unwrap),
    enabled: connectionId != null, retry: false
  })
}
export function useLlmMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['llm', 'messages', conversationId],
    queryFn: () => window.api.llm.listMessages(conversationId!).then(unwrap),
    enabled: conversationId != null, retry: false
  })
}
```

(The chat send + token subscription is wired directly in the panel component in Task 10, since it manages streaming UI state.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → clean

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/hooks.ts
git commit -m "feat: react-query hooks for LLM models/conversations/messages"
```

---

### Task 10: Assistant panel UI + store state + TopBar toggle

**Files:**
- Modify: `src/renderer/src/state/store.ts`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/App.tsx` (or wherever the main layout mounts), `src/renderer/src/styles.css`
- Create: `src/renderer/src/components/AssistantPanel.tsx`

No component tests (repo convention); logic is in the tested pure libs. Verify via typecheck/lint/build + Task 12 smoke.

- [ ] **Step 1: Store UI state**

In `src/renderer/src/state/store.ts`, add to the store state + actions:

```ts
  assistantOpen: boolean
  activeConversationId: string | null
  toggleAssistant: () => void
  setActiveConversation: (id: string | null) => void
```

Initialize `assistantOpen: false, activeConversationId: null`, and implement:

```ts
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
```

- [ ] **Step 2: TopBar toggle button**

In `src/renderer/src/components/TopBar.tsx`, add a button bound to `toggleAssistant` (read it from the store), labelled `💬 Assistant`. Match existing TopBar button markup.

- [ ] **Step 3: AssistantPanel component**

Create `src/renderer/src/components/AssistantPanel.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../state/store'
import { useConnections, useLlmModels, useLlmConversations, useLlmMessages } from '../lib/hooks'
import { extractCodeBlocks } from '../lib/llm-blocks'
import type { LlmMessage } from '@shared/domain'

export default function AssistantPanel(): JSX.Element | null {
  const open = useAppStore((s) => s.assistantOpen)
  const toggle = useAppStore((s) => s.toggleAssistant)
  const connectionId = useAppStore((s) => s.activeConnectionId)
  const convId = useAppStore((s) => s.activeConversationId)
  const setConv = useAppStore((s) => s.setActiveConversation)
  const openQueryTab = useAppStore((s) => s.openQueryTab)

  const { data: models } = useLlmModels()
  const { data: conversations } = useLlmConversations(connectionId)
  const { data: persisted } = useLlmMessages(convId)

  const [draft, setDraft] = useState('')
  const [live, setLive] = useState<LlmMessage[]>([]) // optimistic user msg + streaming assistant msg
  const [streaming, setStreaming] = useState(false)
  const reqRef = useRef<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  // Merge persisted history with any in-flight messages not yet saved.
  const messages: LlmMessage[] = [...(persisted ?? []), ...live]

  useEffect(() => { threadRef.current?.scrollTo(0, threadRef.current.scrollHeight) }, [messages.length, live])

  useEffect(() => {
    const off = window.api.llm.onToken((e) => {
      if (e.requestId !== reqRef.current) return
      if (e.chunk) {
        setLive((prev) => {
          const next = prev.slice()
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + e.chunk }
          return next
        })
      } else if (e.done || e.error) {
        if (e.error) setLive((prev) => [...prev, mkMsg('assistant', `⚠️ ${e.error}`)])
        setStreaming(false); reqRef.current = null
        // The real persisted messages refetch will replace `live` on next query invalidation.
      }
    })
    return off
  }, [])

  function mkMsg(role: 'user' | 'assistant', content: string): LlmMessage {
    return { id: `live-${Math.random().toString(36).slice(2)}`, conversationId: convId ?? '', role, content, createdAt: 0 }
  }

  async function ensureConversation(): Promise<string | null> {
    if (convId) return convId
    if (!connectionId) return null
    const created = await window.api.llm.createConversation(connectionId, draft.slice(0, 40) || 'New chat').then((r) => (r.ok ? r.data : null))
    if (created) setConv(created.id)
    return created?.id ?? null
  }

  async function send(): Promise<void> {
    if (!draft.trim() || !connectionId || streaming) return
    const cid = await ensureConversation()
    if (!cid) return
    const prompt = draft.trim()
    setDraft('')
    setLive([mkMsg('user', prompt), mkMsg('assistant', '')])
    setStreaming(true)
    const res = await window.api.llm.send(cid, connectionId, prompt)
    if (res.ok) reqRef.current = res.data.requestId
    else { setStreaming(false); setLive((prev) => [...prev, mkMsg('assistant', `⚠️ ${res.error}`)]) }
  }

  function stop(): void { if (reqRef.current) void window.api.llm.cancel(reqRef.current) }

  if (!open) return null

  const hasModel = (models?.downloaded.length ?? 0) > 0

  return (
    <aside className="assistant-panel">
      <div className="assistant-head">
        <strong>Assistant</strong>
        <span className="spacer" />
        <select value={convId ?? ''} onChange={(e) => { setConv(e.target.value || null); setLive([]) }}>
          <option value="">New chat</option>
          {(conversations ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button className="btn ghost xs" onClick={toggle} aria-label="Close assistant">✕</button>
      </div>

      {!connectionId && <div className="assistant-empty">Select a connection to get schema-aware suggestions.</div>}
      {connectionId && !hasModel && <div className="assistant-empty">No model yet — open the Model Manager to download one.</div>}

      <div className="assistant-thread" ref={threadRef}>
        {messages.map((m, i) => (
          <div key={m.id + i} className={`assistant-msg ${m.role}`}>
            <div className="assistant-msg-body">{m.content || (streaming && m.role === 'assistant' ? '…' : '')}</div>
            {m.role === 'assistant' && extractCodeBlocks(m.content).map((b, j) => (
              <div key={j} className="assistant-block">
                <pre>{b.code}</pre>
                <button className="btn xs" disabled={!connectionId}
                  onClick={() => connectionId && openQueryTab({ connectionId, title: 'Suggested', text: b.code, runOnOpen: false })}>
                  Insert into new tab
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="assistant-input">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask for a query…"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
          disabled={!connectionId || !hasModel} />
        {streaming
          ? <button className="btn" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={() => void send()} disabled={!connectionId || !hasModel || !draft.trim()}>Send</button>}
      </div>
    </aside>
  )
}
```

Note: on stream `done`, invalidate the messages query so persisted history replaces the optimistic `live` list — add to the token effect's done branch:
`import { useQueryClient } from '@tanstack/react-query'`, `const qc = useQueryClient()`, and in the done branch: `void qc.invalidateQueries({ queryKey: ['llm','messages', cid] })` then `setLive([])`. (Capture `cid` via a ref alongside `reqRef`.)

- [ ] **Step 4: Mount the panel**

In the main layout (`src/renderer/src/App.tsx` or the shell that renders QueryTab/ResultsPanel), render `<AssistantPanel />` as a sibling docked to the right of the main content. Add flexbox so it occupies a fixed-width column when open.

- [ ] **Step 5: Styles**

Append to `src/renderer/src/styles.css`:

```css
/* ── Assistant panel ── */
.assistant-panel { display: flex; flex-direction: column; width: 360px; flex-shrink: 0; border-left: 1px solid var(--border); background: var(--bg-2); }
.assistant-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.assistant-head select { max-width: 160px; }
.assistant-empty { padding: 16px; color: var(--text-2); font-size: 13px; }
.assistant-thread { flex: 1; min-height: 0; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.assistant-msg { font-size: 13px; }
.assistant-msg.user .assistant-msg-body { background: var(--bg-3); border-radius: 8px; padding: 6px 8px; }
.assistant-msg.assistant .assistant-msg-body { white-space: pre-wrap; }
.assistant-block { margin-top: 6px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.assistant-block pre { margin: 0; padding: 8px; overflow: auto; font-size: 12px; background: var(--bg); }
.assistant-block button { margin: 6px; }
.assistant-input { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border); }
.assistant-input textarea { flex: 1; resize: none; height: 56px; }
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build` → all clean

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/components/TopBar.tsx src/renderer/src/App.tsx src/renderer/src/components/AssistantPanel.tsx src/renderer/src/styles.css
git commit -m "feat: assistant side panel — streaming chat + insert-into-tab suggestions"
```

---

### Task 11: Model manager modal

**Files:**
- Modify: `src/renderer/src/state/store.ts` (modal flag), `src/renderer/src/components/AssistantPanel.tsx` (button to open it), the modal mount point, `src/renderer/src/styles.css`
- Create: `src/renderer/src/components/ModelManagerModal.tsx`

- [ ] **Step 1: Store flag**

Add `modelManagerOpen: boolean`, `openModelManager: () => void`, `closeModelManager: () => void` to the store (mirroring existing modal patterns).

- [ ] **Step 2: Component**

Create `src/renderer/src/components/ModelManagerModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../state/store'
import { useLlmModels } from '../lib/hooks'

export default function ModelManagerModal(): JSX.Element | null {
  const open = useAppStore((s) => s.modelManagerOpen)
  const close = useAppStore((s) => s.closeModelManager)
  const { data } = useLlmModels()
  const qc = useQueryClient()
  const [customUri, setCustomUri] = useState('')
  const [progress, setProgress] = useState<{ uri: string; pct: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const off = window.api.llm.onDownloadProgress((e) => {
      if (e.error) { setError(e.error); setProgress(null); return }
      if (e.done) { setProgress(null); void qc.invalidateQueries({ queryKey: ['llm', 'models'] }); return }
      setProgress({ uri: e.uri, pct: e.totalBytes ? Math.round((e.receivedBytes! / e.totalBytes) * 100) : 0 })
    })
    return off
  }, [qc])

  if (!open) return null

  async function download(uri: string): Promise<void> {
    setError(null); setProgress({ uri, pct: 0 })
    const res = await window.api.llm.downloadModel(uri)
    if (!res.ok) { setError(res.error); setProgress(null) }
  }
  async function del(id: string): Promise<void> {
    await window.api.llm.deleteModel(id); void qc.invalidateQueries({ queryKey: ['llm', 'models'] })
  }
  async function setActive(id: string): Promise<void> {
    await window.api.llm.setActiveModel(id); void qc.invalidateQueries({ queryKey: ['llm', 'models'] })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Model manager"
         onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal">
        <div className="modal-header"><h2>Model Manager</h2></div>
        <div className="modal-body">
          <h3>Downloaded</h3>
          {(data?.downloaded.length ?? 0) === 0 && <p className="tree-muted">None yet.</p>}
          {data?.downloaded.map((m) => (
            <div className="model-row" key={m.id}>
              <span>{m.name} <span className="tree-muted">({(m.sizeBytes / 1e9).toFixed(1)} GB)</span></span>
              <span className="spacer" />
              {data.activeModelId === m.id
                ? <span className="chip-ok">active</span>
                : <button className="btn ghost xs" onClick={() => void setActive(m.id)}>Set active</button>}
              <button className="btn ghost xs" onClick={() => void del(m.id)}>Delete</button>
            </div>
          ))}

          <h3>Catalog</h3>
          {data?.catalog.map((m) => (
            <div className="model-row" key={m.id}>
              <span>{m.name} <span className="tree-muted">{m.sizeLabel}</span><br /><span className="tree-muted">{m.description}</span></span>
              <span className="spacer" />
              <button className="btn xs" disabled={!!progress} onClick={() => void download(m.uri)}>Download</button>
            </div>
          ))}

          <h3>Advanced</h3>
          <div className="ssh-key-pick">
            <input type="text" placeholder="hf:org/repo:quant" value={customUri} onChange={(e) => setCustomUri(e.target.value)} />
            <button className="btn" disabled={!customUri.trim() || !!progress} onClick={() => void download(customUri.trim())}>Download</button>
          </div>

          {progress && <div className="status">Downloading… {progress.pct}%</div>}
          {error && <div className="status err" role="alert">{error}</div>}
        </div>
        <div className="modal-footer"><span className="spacer" /><button className="btn primary" onClick={close}>Done</button></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Open button + mount**

In `AssistantPanel.tsx` header add a `⚙ Models` button calling `openModelManager`. Mount `<ModelManagerModal />` next to the other modals (where `ConnectionModal` is mounted).

- [ ] **Step 4: Styles**

Append:

```css
.model-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
```

- [ ] **Step 5: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build` → clean

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/components/ModelManagerModal.tsx src/renderer/src/components/AssistantPanel.tsx src/renderer/src/styles.css
git commit -m "feat: model manager — download (progress), set-active, delete"
```

---

### Task 12: Packaging check, README, full verification + manual smoke

**Files:**
- Modify: `electron-builder.yml` (asarUnpack if needed), `README.md`

- [ ] **Step 1: Ensure the native module is unpacked when packaged**

In `electron-builder.yml`, confirm `node-llama-cpp` (and its bins) are unpacked from the asar. Add if missing:

```yaml
asarUnpack:
  - "**/node_modules/node-llama-cpp/**"
  - "**/node_modules/@node-llama-cpp/**"
```

- [ ] **Step 2: Full gates**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: clean; all new unit tests pass (persistence, schema-context, llm-blocks, catalog, models).

- [ ] **Step 3: Manual smoke (documented; native path)**

Run: `npm run dev`. Then:
1. Open **Assistant** → **⚙ Models** → download the 1.5B catalog model; watch the progress bar finish.
2. Set it active. Select a connection (e.g. the demo postgres).
3. Ask "show me the 10 most recent orders". Confirm tokens stream in.
4. Confirm a ```sql block renders with **Insert into new tab**, and clicking it opens a query tab with that SQL on the connection.
5. Start a long answer and hit **Stop** — generation halts.
6. Restart the app; confirm the conversation is still listed.

- [ ] **Step 4: Packaged check**

Run: `npm run package:mac`, launch `dist/mac-arm64/DB Client.app`, repeat smoke steps 1–4. Confirms the native module loads from the packaged asar.

- [ ] **Step 5: README**

Add a feature bullet:

```markdown
- **Local AI assistant** — a built-in chat, powered by a GGUF model you download and run entirely on your machine (`node-llama-cpp`, no data leaves the app). It's grounded with the active connection's schema, so it recommends queries against your real tables; one click drops a suggestion into a new query tab. Conversations are saved per connection.
```

Update the test-count line to the new unit total (run the suite to get the number).

- [ ] **Step 6: Commit**

```bash
git add electron-builder.yml README.md
git commit -m "docs+build: package node-llama-cpp; README local AI assistant; test counts"
```

---

## Self-review

**Spec coverage:**
- Embedded node-llama-cpp runtime → Tasks 1 (spike), 7 (engine). ✓
- Download a model of choice (curated + custom hf: URI), progress → Tasks 5 (catalog), 6 (download), 8 (streamed progress), 11 (UI). ✓
- Schema-aware grounding → Task 3 (builder) + Task 8 (wired through the tunnel-aware connect). ✓
- Insert suggestion into a new tab → Tasks 4 (extractor), 10 (button → openQueryTab). ✓
- Dockable side panel → Task 10. ✓
- Persisted conversations per connection → Tasks 2 (tables/CRUD), 8/10/11 (wiring). ✓
- Streaming via new main→renderer push channel → Tasks 8 (send/preload), 10 (subscription). ✓
- Cancel/Stop → Tasks 8 (cancel handler + AbortController), 10 (Stop button). ✓
- Packaging (asarUnpack/ABI) → Tasks 1 (dev load), 12 (packaged). ✓
- Tests: pure libs unit-tested; native smoke documented → Tasks 2–6 (unit), 12 (smoke). ✓

**Placeholder scan:** Task 7 has an implementer note about an optional history-replay refactor but ships complete working code (not a placeholder). Task 10 Step 3 has a precise follow-on note (invalidate + clear `live` on done) with the exact code — fold it into the component when implementing. No "TODO"/"handle errors"/empty blocks remain.

**Type consistency:** `LocalModel`/`CatalogModel`/`LlmConversation`/`LlmMessage`, `buildSchemaContext(dialect, {object,columns}[], maxChars?)`, `extractCodeBlocks→{lang,code}`, `LlmEngine.generate(systemPrompt, history, userText, onChunk, signal)`, the `llm.*` channels, and `LlmTokenEvent`/`LlmDownloadEvent` are used identically across tasks. The chat handler reuses `connectStored`/`drivers`/`conns`/`store` already present in ipc.ts from the SSH work.

**Seam to watch during execution:** the exact main-layout file that mounts the panel (Task 10 Step 4) and where modals mount (Task 11 Step 3) — confirm against the current `App.tsx`/shell before editing. node-llama-cpp's exact v3 download-progress field names (`downloadedSize`/`totalSize`) should be confirmed in the Task 1 spike and adjusted in Task 6 if the library differs.
