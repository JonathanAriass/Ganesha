# Assistant repo context — design

**Goal:** Link a local code repository to a connection so the on-device assistant can pull the
relevant code (ORM models, migrations, entities) into its context and suggest better queries.

## Why / viability

The assistant grounds on the live schema (`buildSchemaContext`, ~6000-char budget) inside the system
prompt. Small models hold only a few thousand tokens, so the repo can't be dumped — the viable shape
is **retrieval**: pull only the few files for the tables actually in play. Code adds the semantics the
bare schema lacks (relationships, enums, conventions). The retrieval is model-agnostic; the *use* of
the snippets scales with model size — worth it with the 7B Coder, marginal below.

## Decisions (from brainstorming)

- **Per-connection** linked repo. **Question-driven** retrieval (tables in the message + the open
  query tab). **PHP backend** (Laravel/Doctrine conventions tuned, generic fallback).

## Data model & UI

- `repoPath: string | null` on the connection (`ConnectionInput`/`Connection` in `shared/domain.ts`).
- sqlite `repo_path TEXT` column via the existing idempotent column migration (like `ssh_json`);
  included in `connections.ts` create/update/row-map.
- `ConnectionModal`: a "Linked repo (optional)" field with **Browse…** (`dialog.pickDirectory`) and a
  Clear (×). Empty = feature off; the assistant behaves exactly as today.

## Retrieval pipeline (main, per chat)

Appended to the existing schema-grounded system prompt only when `connection.repoPath` is set.

1. **Relevant tables** — `relevantTables(message, queryText, knownTables)`: the connection's *known*
   table names (from the schema it already fetched) that appear (word-boundary, case-insensitive) in
   the user's message **or the active query tab's SQL** (passed from the renderer in `chat.send`).
   No match → inject nothing.
2. **Find code** — bounded walk of `repoPath` (skip `.git`, `vendor`, `node_modules`, `.env*`,
   binaries, files > ~256 KB; cap total files scanned). Match each table against filenames + content
   using `tableNameVariants(table)` (snake_case ↔ CamelCase, basic singular/plural, so `users` finds
   `User.php` *and* `..._create_users_table.php`). `rankRepoFiles` ranks: filename hit > model/entity/
   migration path (`app/Models`, `database/migrations`, `src/Entity`, `Entities/`, `Models/`) >
   content hit; `*.php`/`*.sql` boosted.
3. **Budget** — read the top files (injected reader), truncate to a code budget (~8000 chars, separate
   from the schema budget); a large file contributes the window around the first table mention.
   Append as `// path/to/File.php\n<snippet>` blocks under a "Relevant code from the linked repository"
   heading.

## Transparency & privacy

The turn emits the **used file paths** once (a `llm.context` push event, `{ requestId, files }`),
shown by `AssistantPanel` as a small "📎 context: …" line by the reply — so you can verify the
grounding. Everything is local: main reads the files, nothing leaves the machine (local model);
ignored/`.env`/binary paths are skipped.

## Components

- `src/main/llm/repo-context.ts` (pure, the disk reader injected): `relevantTables`,
  `tableNameVariants`, `rankRepoFiles`, `buildRepoContext({ tables, files, readFile, budget })` →
  `{ text, usedFiles }`.
- `src/main/llm/repo-scan.ts` (fs): `scanRepoFiles(repoPath)` → bounded list of file paths (skip
  list + caps); `readRepoFile(path)`.
- `src/main/ipc.ts` `llm.chat.send`: gains `queryText?: string`; assembles
  `systemPrompt = base + schema + repoContext`, emits `llm.context`.
- `src/shared/ipc.ts`: `llm.chat.send.req` gains `queryText?`; new `llm.context` push channel.
- `src/renderer/.../AssistantPanel.tsx`: pass the active tab's text as `queryText`; render the used
  files.

## Out of scope (YAGNI)

Embeddings/RAG; a persisted cross-restart index; watching the repo for changes; multi-repo per
connection; region-extraction beyond a simple window.

## Testing

`repo-context.ts` unit-tested with an injected file list + reader: `relevantTables` (message/query
matches, word boundaries, unknown tables ignored), `tableNameVariants` (snake↔Camel, plural), 
`rankRepoFiles` (filename > path > content; php/sql boost), `buildRepoContext` (budget truncation,
usedFiles). The fs walk + LLM wiring verified live (7B Coder). Pure renderer/main libs — integration
suite unaffected.
