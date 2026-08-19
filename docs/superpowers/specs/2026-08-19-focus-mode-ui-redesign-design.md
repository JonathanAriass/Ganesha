# Focus Mode UI Redesign — Design

**Date:** 2026-08-19
**Status:** Approved direction (user picked "Focus Mode" from 4 mock directions; iterated and approved the mock)
**Reference mock:** `ui-mocks/focus.html` (kept as the visual reference; `ui-mocks/index.html` compares all 4 directions)

## Goal

Restyle Ganesha's shell around an editor-forward "Focus Mode": a slim icon rail with an
on-demand, resizable side panel; a global command bar; a slide-in AI assistant; and a status
bar — with the roomier, calmer visual language of the mock. The two-pane query split the mock
demonstrated **already exists** in the app (resizable `PaneDivider`, `pane-split` localStorage)
and is kept as-is.

## What exists today (from the code map)

- Shell: `.app` (flex column) → `TopBar` (38px) → `UpdateBanner` → `.app-body` (flex row):
  `.sidebar` (fixed 260px, **not** resizable) | `.main` (tab strip + `.panes` split) |
  `AssistantPanel` | `SsmPanel`. No status bar.
- Sidebar stacks `ObjectTree` (filter + sort) + `SavedSection` + `HistorySection` (`<details>`).
  Connection picker lives in `TopBar`.
- Per-tab `qt-toolbar` in `QueryTab`: Run / Run all / ↻ Refresh / ☆ Save / Cancel + conn chip +
  status text (`statusEl`: Running…/script progress/row-count).
- `AssistantPanel`: flex-docked right, conditional render on `assistantOpen`, left-edge resizer,
  width persisted (`assistant-width`, 320–900, default 420).
- Split view: drag a tab to a side or ⊟ button; `focusedPane`/`activeTabByPane` in the store;
  `normalizePanes` collapses an empty left pane.

## Design

### 1. Icon rail + switchable side panel (replaces the fixed sidebar)

**Rail** — a 52px vertical strip at the far left (`.rail`), always visible:

| Button | Action |
|---|---|
| Schema (db icon) | opens/switches the side panel to the schema `ObjectTree` |
| Saved (bookmark) | side panel → `SavedSection` content |
| History (clock) | side panel → `HistorySection` content |
| ER diagram | opens the existing schema-diagram tab (same store action the ⌘K palette's "Open schema diagram" item uses) — no panel |
| *(bottom)* Collapse/expand | toggles the side panel (same as ⌘B) |

- Active content button gets the accent tint + a 3px left indicator bar (per mock).
- Hover tooltips (title text + kbd hint) reuse the existing `data-tooltip` pattern.
- `TopBar` keeps brand, connection picker, and the settings/assistant/SSM toggles — the rail is
  purely left-side navigation. (Settings stays in TopBar; the mock's rail-settings button is dropped
  to avoid duplication.)

**Side panel** — one section at a time (no more three stacked sections):

- Content = Schema tree (with its existing sticky filter + sort select) OR Saved OR History.
  `SavedSection`/`HistorySection` lose their `<details>` wrapper when hosted here (the rail *is*
  the disclosure); their internals (two-step delete, run-on-click) are unchanged.
- **Resizable**: right-edge drag handle using the `AssistantPanel` resizer pattern
  (pointer capture, inline width during drag, commit on release). Clamp 200–480px, default 264px.
- **Collapsible**: clicking the active rail button (or ⌘B) closes the panel to rail-only.
  Opening restores the last width and section.
- Empty-connection state: Saved/History sections already return `null` without an active
  connection — the panel shows a small "no connection" hint instead of nothing.

**State & persistence**

| What | Where |
|---|---|
| `sideOpen: boolean` (default true), `sideSection: 'schema' \| 'saved' \| 'history'` (default `'schema'`) | zustand store + localStorage (`side-open`, `side-section`) |
| Panel width | localStorage `side-width` via a new pure lib `lib/side-width.ts` (clamp/load/save, mirroring `assistant-width.ts`) |

### 2. Global command bar + status bar (replaces the per-tab qt-toolbar)

**Command bar** — the run cluster moves into `TopBar` (height 38px → 46px), right-aligned per the
mock: `↻ Refresh · ☆ Save · ▶▶ Run all · | · ▶ Run ⌘↵` (+ `Cancel` while running). It acts on
**the focused pane's active tab** (`focusedPane` → `activeTabByPane`).

- Mechanism: `QueryTab` already owns `run()` / `runAll()` / `refresh()` closures (they need the
  Monaco editor handle for selection/statement-at-cursor). Each `QueryTab` registers its handlers
  in a module-level registry keyed by tab id (`lib/tab-actions.ts` — same pattern as the Monaco
  completion `ctxByModel` registry) on mount, unregisters on unmount. The command bar looks up
  the focused tab's handlers; buttons disable when there is no query tab focused (e.g. diagram/
  telescope tab active) or per the existing rules (`running`, `!text.trim()`, `!lastRunText`).
- The per-tab `qt-toolbar` row is **removed** from `QueryTab`. With two panes, the **focused pane**
  gets a subtle accent indicator (2px top border on the pane) so it's obvious which pane ⌘↵/Run
  targets. Keyboard behavior is unchanged (⌘↵ runs in the editor that has focus, as today).
- The conn chip that lived in qt-toolbar is covered by the TopBar connection picker + status bar.

**Status bar** — a new 26px footer (`.statusbar`) across the app bottom, showing the focused
tab's state: run status (`Running…` / script progress / `✓ N rows · X ms` / error indicator —
the existing `statusEl` logic moves here mostly verbatim), plus the active connection name+color
dot and a 🔒 read-only badge. Diagram/telescope tabs show just the connection.

### 3. Assistant becomes a slide-in overlay

- `AssistantPanel` changes from a flex-docked sibling to a **fixed overlay** anchored to the
  right edge (below the TopBar, above the status bar), sliding in/out with a ~250ms transform
  transition. `assistantOpen` still drives it — but it stays mounted while closed (translated
  off-screen) so the slide animates; conversation state keeps living in the store as today.
- A **peek tab** (~36px, vertical "✦ Assistant" label) stays visible at the right edge when
  closed — click = `toggleAssistant()`. The TopBar toggle keeps working.
- Width resize is unchanged (`assistant-width` lib, left-edge handle — same math, since the
  panel is still right-anchored). z-index sits below modals/palette (1000/1100) at ~900.
- `SsmPanel` is **out of scope** — it stays a docked sibling, unchanged. (When the assistant
  overlay is open it may cover the SSM panel; acceptable, both are rarely open together.)

### 4. Visual polish (theme-compatible)

- Spacing/rounding pass per the mock: tab strip and buttons get slightly larger radii and
  breathing room; the editor area keeps a hairline border and its badge row (already exists as
  the results/status pieces); panels use existing surface tokens.
- **Constraint: everything is expressed through the existing theme variables** (`--bg`, `--bg-2`,
  `--bg-3`, `--border`, `--accent`, `--text*`, `--radius`…) so all 10 themes work unchanged. The
  rail and side panel use `var(--bg-2)`; the workspace `var(--bg)`. New layout-only variables
  (`--rail-w: 52px`, `--topbar-h: 46px`, `--statusbar-h: 26px`) are theme-independent.
  No per-theme edits required.

### Keyboard

- **⌘B / Ctrl+B** (new): toggle the side panel. Registered in `use-global-shortcuts.ts`
  (guarded like the others so it doesn't fire in inputs; Monaco doesn't bind ⌘B).
- All existing chords unchanged (⌘K, ⌘T, ⌘W, ⌘,, ⌘↵, ⇧⌘↵, ⌘S).

### Out of scope

- SsmPanel restyle, multi-pane (>2) layouts, per-pane editor-split overrides, TopBar connection
  picker redesign, any change to tab drag/split mechanics, the Windows/Linux titlebar treatment.

## Build order (each step ships independently, all 10 themes verified per step)

1. **Rail + side panel** — new `Rail` + `SidePanel` components, `lib/side-width.ts`, store fields,
   ⌘B; sidebar CSS replaced. Biggest visual change, no behavior change to queries.
2. **Command bar + status bar** — `lib/tab-actions.ts` registry, TopBar run cluster, `.statusbar`,
   remove qt-toolbar, focused-pane indicator.
3. **Assistant slide-in** — overlay + peek + transition; resize/width logic untouched.
4. **Polish pass** — spacing/radius/tab styling to match the mock across themes.

## Testing

- New pure libs (`side-width.ts`, `tab-actions.ts`) get unit tests (clamp math, register/lookup/
  unregister, focused-tab resolution).
- Store: `sideOpen`/`sideSection` defaults + toggle actions tested alongside existing store tests.
- Existing 817 tests must stay green at every step (notably: session restore, tab close/split
  invariants, and the `startRun`/`finishRun` flow, which are untouched).
- Manual check per step: all 10 themes × light/dark, split view active, assistant open/closed.

## Risks & mitigations

- **Global Run vs. focused pane ambiguity** → focused-pane accent indicator; buttons disable with
  no query tab focused; ⌘↵ semantics unchanged.
- **Lifted run handlers leak** → registry entries removed in `QueryTab` unmount cleanup (same
  lifecycle as the Monaco completion registry, which has proven reliable).
- **Assistant overlay covers results** → user-invoked and instantly dismissible (peek click,
  TopBar toggle, or the panel's ✕); width clamp keeps ≥480px of workspace visible.
- **Sidebar muscle memory** → panel defaults to open with the schema tree, so the first paint
  looks familiar; only the chrome changes.
