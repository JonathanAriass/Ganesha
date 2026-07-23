# On-Demand, Crash-Isolated LLM Engine — Design

**Date:** 2026-07-23
**Branch:** `feat/llm-ondemand-engine`
**Status:** Approved — building

## Problem

The bundled local-LLM native binaries (`@node-llama-cpp/mac-arm64-metal`: `libggml*.dylib/.so`, `llama-addon.node`, ~5 MB, unsigned) cause **two** real failures on current macOS:

1. **macOS XProtect deletes the whole app** as "malicious software" (false-positive on the unsigned native blobs in the `.app`). Confirmed: the dialog is XProtect, and un-bundling removes what it scans.
2. **The app crashes** — a captured `.ips` shows `ggml_uncaught_exception → std::terminate → SIGABRT` on a llama.cpp worker thread. This is a **C++ abort no JS `try/catch` can ever catch**; it kills the whole main process.

Notarization would fix #1 but **not #2**. So both changes are worth doing.

## Goal

Stop bundling the native engine; download it on demand into a writable `userData` dir; run it in a **separate process** so a native abort can never take down the app.

## Confirmed mechanism (spike passed)

node-llama-cpp 3.18.1 resolves its prebuilt binary via `getPrebuiltBinaryPath()` → first `path.join(llamaPrebuiltBinsDirectory, folderName)` where `llamaPrebuiltBinsDirectory = join(__dirname,'..','bins')` (config.js:13), then a fallback `import('@node-llama-cpp/<variant>')`. The binary set is **fully relocatable** (`llama-addon.node` has `LC_RPATH=@loader_path`; the ggml `.so` backends load from `path.dirname(bindingPath)`), so all 8 files in one dir is sufficient.

**Spike result (verified):** patching config.js so
```js
export const llamaPrebuiltBinsDirectory = process.env.GANESHA_LLAMA_BINS_DIR ?? path.join(__dirname, "..", "bins");
```
then removing `@node-llama-cpp` entirely and running `getLlama({build:'never'})` with `GANESHA_LLAMA_BINS_DIR` pointed at a dir containing the 8 files → **loads successfully, `gpu: metal`.** So: patch (1 line, via `patch-package`) + env var + the 8 files in `$DIR/mac-arm64-metal/` is all that's needed. No `@node-llama-cpp` package in the app at all.

The 8 files (`@node-llama-cpp/mac-arm64-metal/bins/mac-arm64-metal/`): `llama-addon.node`, `libllama.metal.b8390.dylib`, `libggml.metal.b8390.dylib`, `libggml-base.dylib`, `libggml-metal.so`, `libggml-cpu.so`, `libggml-blas.so`, `_nlcBuildMetadata.json` (both `llama-addon.node` **and** `_nlcBuildMetadata.json` are required or resolution returns null).

## Architecture

```
main (ipc.ts)                         utilityProcess: engine-worker
─────────────                         ─────────────────────────────
EngineHost                            (env GANESHA_LLAMA_BINS_DIR = userData/ai-engine/<v>)
  .load(modelPath) ── message ──▶     import('node-llama-cpp') → getLlama({build:'never'})
  .generate(...)   ── message ──▶       loadModel → LlamaChatSession.prompt
  onToken/onDone/onError ◀── postMessage ── streamed tokens
  child 'exit' (SIGABRT) ─▶ reject in-flight, push llm:token{error}, mark not-ready, respawn lazily
                             (MAIN STAYS ALIVE)
```

- **Un-bundle** (electron-builder.yml): exclude `@node-llama-cpp/**` from the app (`files` negation + drop the asarUnpack entry). Keep pure-JS `node-llama-cpp`. → the `.app` ships **zero native LLM binaries** → XProtect can't flag/delete it.
- **patch-package**: persist the config.js one-liner (env-var bins dir).
- **On-demand download**: ship a version-pinned tarball of the 8 files on the GitHub release. On first AI use, download (progress) + checksum-verify + extract to `userData/ai-engine/<nlcVersion>/mac-arm64-metal/`, write a sentinel. The worker sets `GANESHA_LLAMA_BINS_DIR = userData/ai-engine/<nlcVersion>`.
- **Crash isolation**: the engine runs in an Electron `utilityProcess` (Node/ESM child with structured IPC + observable `exit`). Native abort kills only the child; `EngineHost` catches `exit`, reports an error, stays alive, respawns on next use.

## Key constraints

- **Version pinning:** the downloaded binaries' version must equal the shipped `node-llama-cpp` version (getBinsDir/packageVersion check + N-API ABI). Gate the tarball URL + userData subdir on `nlcVersion`; re-download on mismatch. Regenerate the tarball whenever node-llama-cpp is bumped.
- **macOS arm64 only** for now (matches the app's current single target). Structure `folderName`/variant so other platforms can be added later.
- **Two prerequisites** for chat now: the **engine** (~5 MB, once) *and* a **model** (as today). UI must gate both distinctly.
- **Honest caveat:** un-bundling stops the app-deletion + (with isolation) the crashes. The downloaded binaries are still unsigned, so on the strictest macOS the *engine* may still be flagged at load — in which case the assistant shows "unavailable" and **the app keeps working**. Notarization remains the durable fix for the AI feature itself.
- Do **not** call `app.setName` / change userData dir (`db-client`) — breaks safeStorage. `userData/ai-engine` sits under the existing pinned data dir.
- **Dev:** in `electron-vite dev`, `@node-llama-cpp` is present in repo node_modules, so the engine can load in-process/normally; the worker + env-var path must degrade gracefully (or exercise the same subprocess path with the repo binaries). Decide per phase.

## Phases

0. **Spike** — DONE (mechanism confirmed).
1. **Engine subprocess** — `utilityProcess` worker hosting node-llama-cpp; `EngineHost` (load/generate/cancel/unload + crash handling) in main; rewire `ipc.ts` chat.send (native-free setup stays in main); kill on quit. Second electron-vite rollup input for the worker.
2. **Un-bundle packaging** — electron-builder exclusion + `patch-package` for config.js.
3. **On-demand download + gate** — `getEngineBinDir()`, `llm.engine.status` + `llm.engine.download` (streamed), checksum, sentinel, worker env-var wiring; gate chat.send.
4. **UI + CI + tests/docs** — AssistantPanel/ModelManager engine-install step; release CI generates + attaches the version-matched engine tarball; unit tests (host protocol, download/verify, gate); full gates; README.

## Testing

- Unit: EngineHost protocol (message routing, crash → reject-and-survive, respawn), download/checksum/extract logic (pure), engine-installed gate, version-mismatch → re-download.
- Manual: dev run (in-process still works); packaged build ships no native binaries (`unzip -l` the artifact); first-use download flow; kill the worker mid-generate → app survives + shows error.
