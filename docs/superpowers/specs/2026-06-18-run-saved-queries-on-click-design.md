# Run saved queries on click — design

**Goal:** Clicking a saved query runs it immediately, instead of only loading its text into the editor.

## Current behavior

A saved-query click calls `openOrLoadQuery({ connectionId, title, text })`, which **loads** the
text — reusing the active tab when it belongs to the same connection, else opening a new tab — but
never executes it. The user then has to press Run.

There is already an auto-run mechanism: a `QueryTabData.runOnOpen` flag. A tab created with
`runOnOpen: true` runs once on mount (the `useEffect` in `QueryTab.tsx` calls `run()`), and
`startRun` clears the flag so it never re-fires on remount. The object tree's table double-click
(`ObjectTree.tsx`) and the Command Palette's object items already use this.

## Decision

Clicking a saved query **always opens a new tab** and auto-runs it (user's choice), rather than
reusing the active tab. This never clobbers an in-progress draft and reuses the existing, well-tested
`runOnOpen` path with zero new mechanism.

## Change

Two call sites swap one store action — from `openOrLoadQuery` (load, reuse) to
`openQueryTab({ …, runOnOpen: true })` (new tab, auto-run):

1. `src/renderer/src/components/SavedSection.tsx` — the saved-item open button's `onClick`.
2. `src/renderer/src/components/CommandPalette.tsx` — the "Saved — {conn}" item's `onSelect`
   (kept consistent with the sidebar so ⌘K behaves the same; still calls `close()` after).

Both pass `title: q.name` and `text: q.query`, so the new tab is named after the saved query.

No changes to `QueryTab`, the store, or the `runOnOpen` mechanism. The new tab mounts and the
existing mount effect runs it.

## What auto-run executes

The mount effect calls `run()` with no override. `runnableText()` returns the whole `tab.text` when
the tab holds a single statement (the common case for a saved query) or when the editor hasn't
mounted yet — so a single-statement saved query runs in full. A multi-statement saved query runs the
statement at the cursor, exactly as pressing Run (⌘↵) does today.

## Out of scope (YAGNI)

- **History clicks** stay load-only — history is "load to inspect/edit," a different intent from
  launching a saved query. Unchanged.
- **Run-all-on-click** for multi-statement saved queries — use ⌘⇧↵ (Run all) as today.
- **A setting** to toggle run-on-click — not requested.

## Testing

Pure wiring: the change swaps which already-tested store action a click invokes; `openQueryTab` and
the `runOnOpen` auto-run path are exercised today by the object tree. No new pure logic, so no new
unit test. Verification is `npm run typecheck && npm run lint && npx vitest run` (no regressions) plus
a live click in the running app.
