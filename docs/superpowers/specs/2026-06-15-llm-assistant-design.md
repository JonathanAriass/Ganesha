# Local LLM SQL Assistant — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorming) — ready for implementation plan
**Goal:** A built-in, fully-local chat assistant that recommends queries for the active connection. The user downloads a GGUF model of their choice, opens a dockable chat panel, and gets schema-aware SQL/Mongo suggestions they can drop straight into a query tab.

---

## Approved scope

- **Runtime: embedded `node-llama-cpp` (v3)** — llama.cpp in-process, no external daemon. The app downloads GGUF model files itself.
- **Schema-aware** — each prompt is grounded with the active connection's tables/columns + engine dialect so suggestions reference real objects.
- **Action: insert a suggested query into a new query tab** on the active connection. No copy button, no run-from-chat in v1.
- **Dockable side panel**, conversations **persisted to sqlite** per connection.

### Non-goals (v1, YAGNI)

- Cloud/remote LLM backends; an external Ollama daemon.
- Running queries directly from chat (the model could suggest a mutation — keep execution behind the editor + existing read-only guard).
- Multi-model concurrent loading; fine-tuning; embeddings/RAG over data rows.
- Running inference in a separate `utilityProcess` (noted as a future refinement; v1 runs in main).
- Tool-calling / function-calling agent loops — the model returns text with fenced code blocks.

---

## Architecture — embedded llama.cpp in `main`, renderer talks over IPC

The renderer never loads the model. A `main`-side `LlmService` owns everything; the renderer drives it through IPC and receives streamed tokens via a new main→renderer push channel. Five units, each independently testable where it's pure:

1. **Model manager** — `src/main/llm/models.ts`. Lists downloaded models in the app-data `models/` dir, downloads new ones (node-llama-cpp `createModelDownloader`, supports Hugging Face `hf:org/repo:quant` URIs) with progress, deletes them, and records the active model. A small **curated catalog** (`src/main/llm/catalog.ts`, pure data) offers a few good local SQL-capable GGUF models (2–3 sizes); an advanced field accepts any `hf:` URI.
2. **Engine/chat** — `src/main/llm/engine.ts`. `getLlama()` → `loadModel({modelPath})` → `createContext()` → `LlamaChatSession`; `session.prompt(text, { onTextChunk, signal })` streams tokens. Holds at most one loaded model; loading a different one disposes the previous. Generation is cancelable via an `AbortController` keyed by request id.
3. **Schema context** — `src/main/llm/schema-context.ts` (**pure, unit-tested**). Turns `driver.listObjects` + `driver.describeObject` (or Mongo field inference) into a compact `CREATE TABLE`-style summary plus a dialect line, truncated to a character budget that approximates the model's context window. This becomes the system prompt.
4. **Suggestion parsing** — `src/renderer/src/lib/llm-blocks.ts` (**pure, unit-tested**). Extracts fenced ```sql / ```js / ```javascript code blocks from a model message → `{ lang, code }[]`, so the panel can render an "Insert into new tab" button per block.
5. **Persistence** — `llm_conversations` + `llm_messages` tables (sqlite), scoped per connection, mirroring history/saved-queries patterns. Active model id lives in `settings`.

## Data flow & IPC

Non-streaming calls use the existing `invoke` + `Result<T>` pattern. Token streaming requires a **new main→renderer push direction** (the app currently only does renderer→main `invoke`):

**invoke channels (renderer→main):**
- `llm.models.list` → `{ downloaded: LocalModel[]; catalog: CatalogModel[]; activeModelId: string | null }`
- `llm.models.download` `{ uri }` → starts a download (progress pushed); resolves when started
- `llm.models.delete` `{ id }`
- `llm.models.setActive` `{ id }`
- `llm.conversations.list` `{ connectionId }` / `.create` `{ connectionId, title }` / `.delete` `{ id }`
- `llm.messages.list` `{ conversationId }`
- `llm.chat.send` `{ conversationId, connectionId, prompt }` → persists the user message, starts generation, returns a `requestId`; tokens stream via push
- `llm.chat.cancel` `{ requestId }`

**push channels (main→renderer, via `webContents.send`):**
- `llm:token` `{ requestId, chunk }` … terminated by `{ requestId, done: true }` or `{ requestId, error }`
- `llm:download` `{ uri, receivedBytes, totalBytes }` … `{ uri, done }` / `{ uri, error }`

The preload exposes subscriptions (`api.llm.onToken(cb)`, `api.llm.onDownloadProgress(cb)`) returning unsubscribe fns. On `done`, main persists the full assistant message to sqlite.

## UI

- A **dockable side panel** (`src/renderer/src/components/AssistantPanel.tsx`) toggled from the TopBar, scoped to the active connection: conversation list (new/switch/delete), a message thread (user/assistant bubbles, streaming text), a prompt box with Send/Stop. Assistant messages render markdown; fenced query blocks get an **Insert into new tab** button → `openQueryTab({ connectionId, text })`.
- A **model manager** (`src/renderer/src/components/ModelManagerModal.tsx`): downloaded models with size + delete + "set active"; the curated catalog with Download buttons + a progress bar; an advanced `hf:` URI field. Reached from the panel header and/or settings.
- Disabled/empty states: no model downloaded → the panel prompts the user to open the model manager; no active connection → prompt to pick one (schema grounding needs it).

## Error handling

- No model loaded / load failure → a clear panel error, not a crash.
- Download failure (bad URI, network) → surfaced on the catalog row.
- Generation error (OOM on a too-big model for available RAM) → streamed as an `error` event and shown in the thread; the model is unloaded so the app stays usable.
- Schema too large → summarized/truncated with a note in the system prompt; never sends thousands of columns.

## Testing

- **Unit (vitest, pure libs):** schema-context builder (truncation, dialect line, empty schema), code-block extraction (multiple blocks, languages, no blocks, unterminated fence), curated-catalog shape, conversation/message persistence (CRUD, cascade on connection/conversation delete).
- **Native inference is NOT unit-tested** (heavy native dep). A documented manual smoke test in the running app: download a small model, ask a question, confirm streamed tokens + a working "Insert into new tab".
- No component tests (repo convention).

## Key risks (resolve in the plan's first task — a spike)

1. **node-llama-cpp is ESM-only + ships native binaries.** electron-vite externalizes deps (good — must NOT bundle the native module). The CJS main bundle likely needs a dynamic `import('node-llama-cpp')`. Must load in BOTH dev and a packaged build. The plan's Task 1 is a spike proving load + a one-token generation end to end before building features on it.
2. **Packaging:** the native `.node` + llama.cpp libs must be `asarUnpack`'d and rebuilt for Electron's ABI (same class as better-sqlite3; `electron-builder install-app-deps`). Verify in `npm run package:mac`, not just dev.
3. **Memory:** a multi-GB model loads into the main process. Acceptable for v1; the curated catalog favors small quantized models and the UI shows sizes.

## File structure

- `src/shared/domain.ts` — `LocalModel`, `CatalogModel`, `LlmConversation`, `LlmMessage` types.
- `src/main/llm/catalog.ts` — curated GGUF catalog (pure data).
- `src/main/llm/models.ts` — download/list/delete/active (uses paths `getModelsDir`).
- `src/main/llm/engine.ts` — load + chat session + streaming + cancel.
- `src/main/llm/schema-context.ts` — pure schema→prompt builder (+ test).
- `src/main/persistence/llm.ts` — conversations/messages CRUD (+ test); `db.ts` tables.
- `src/main/persistence/paths.ts` — `getModelsDir()`.
- `src/main/ipc.ts` — the `llm.*` handlers + push wiring.
- `src/preload/index.ts`, `src/shared/api.ts`, `src/shared/ipc.ts` — channel types + `api.llm.*` incl. event subscriptions.
- `src/renderer/src/lib/llm-blocks.ts` — code-block extraction (+ test).
- `src/renderer/src/lib/hooks.ts` — react-query hooks + streaming subscription hook.
- `src/renderer/src/components/AssistantPanel.tsx`, `ModelManagerModal.tsx` — UI.
- `src/renderer/src/state/store.ts` — panel open/active-conversation UI state.
- New dep: `node-llama-cpp`.

## Open follow-ups (post-v1)

- Run inference in an Electron `utilityProcess` for crash isolation.
- Copy button / run-from-chat (behind a confirmation).
- Token-budget-aware schema selection (only tables relevant to the prompt).
- Cloud/remote backends behind the same internal interface.
