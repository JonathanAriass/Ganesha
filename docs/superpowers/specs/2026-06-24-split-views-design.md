# Split Views (two side-by-side editor groups) — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming)
**Branch:** `feat/schema-diagram` (in-flight feature branch) — or a fresh `feat/split-views` cut from it.

## Goal

Let the user view **two query/table tabs at once**, side by side, in the main area.
The two sides are independent and connection-agnostic: the right side can hold a
tab from the **same** connection (e.g. table `105` left, `106` right) or a
**completely different** connection (conn A left, conn B right).

## Requirements (settled in brainstorming)

- **Model:** two side-by-side editor *groups*. Each side has its own tab strip and
  its own active tab (the VS Code editor-group model, capped at two groups).
- **Orientation:** vertical divider only (left | right), drag-to-resize.
- **Create a split:** a **Split** button on the tab bar + a right-click tab menu
  item **"Move to other side."** No drag-and-drop.
- **Collapse:** when a side loses its last tab, the split collapses back to one pane.
- **Focus:** the focused side drives the sidebar and is the target for new tabs.

## Non-goals (YAGNI — explicitly deferred)

- No drag-and-drop of tabs between sides.
- No 3+ panes; no recursive/tiling splits.
- No horizontal (top/bottom) orientation.

The `pane` field is a plain string, so widening to more panes later needs no rework.

---

## Architecture: Approach A (flat tabs + a `pane` field)

Keep the existing **flat `tabs: QueryTabData[]` array** — everything already built on
it (close family, `tab-groups.ts`, hydrate, session persistence) keeps working. Add a
`pane` discriminator to each tab plus per-pane "active" tracking in the store. The
existing `TabBar` and `QueryTab` components are reused per-pane.

### State model

```ts
type PaneId = 'left' | 'right'

interface QueryTabData {
  // ...all existing fields...
  pane: PaneId            // which side this tab lives in; default 'left'
}

interface AppState {
  // ...existing...
  tabs: QueryTabData[]                              // STILL flat

  // Focused-pane MIRRORS — kept in sync by every mutating action so the sidebar,
  // global shortcuts, and session persistence keep reading these unchanged:
  activeTabId: string | null                        // === activeTabByPane[focusedPane]
  activeConnectionId: string | null                 // === activeConnByPane[focusedPane]

  // NEW per-pane source of truth:
  focusedPane: PaneId
  activeTabByPane:  Record<PaneId, string | null>
  activeConnByPane: Record<PaneId, string | null>

  lastActiveByConnection: Record<string, string>    // unchanged (global)
  _queryCounter: number
}
```

**`splitView` is DERIVED, never stored:** `tabs.some(t => t.pane === 'right')`.

### Invariants

1. **Right-empty ⇒ all tabs are `left`.** "Not split" is always a single canonical
   left pane, pixel-identical to today's behavior.
2. **Left is never empty while right is non-empty.** If the left pane loses its last
   tab while the right still has tabs, re-home all right tabs to `left` (collapse).
3. **Mirror invariant:** after every action,
   `activeTabId === activeTabByPane[focusedPane]` and
   `activeConnectionId === activeConnByPane[focusedPane]`.
4. **`focusedPane` always points at a non-empty pane** (or `'left'` when there are no
   tabs at all).

A single helper recomputes the mirror at the end of each action:

```ts
function withMirror(next: {
  focusedPane: PaneId
  activeTabByPane: Record<PaneId, string | null>
  activeConnByPane: Record<PaneId, string | null>
}) {
  return {
    ...next,
    activeTabId: next.activeTabByPane[next.focusedPane],
    activeConnectionId: next.activeConnByPane[next.focusedPane],
  }
}
```

---

## Pure helpers — `src/renderer/src/lib/panes.ts` (new, fully unit-tested)

The tricky rules live here as pure functions so they can be tested without React or
the store:

```ts
export type PaneId = 'left' | 'right'

/** The opposite pane. */
export function otherPane(p: PaneId): PaneId

/** Tabs belonging to a pane, display order preserved. */
export function paneTabs<T extends { pane: PaneId }>(tabs: T[], p: PaneId): T[]

/** The tab to activate in `pane` after `removedId` leaves it: the nearest survivor in
 *  that pane (after the removed index, else before), else null. */
export function nextActiveInPane<T extends { id: string; pane: PaneId }>(
  tabs: T[], pane: PaneId, removedId: string
): string | null

/** Normalize panes to satisfy invariants 1 & 2: if there are right tabs but no left
 *  tabs, rewrite every tab to `left`. Returns the (possibly rewritten) tabs plus the
 *  set of pane ids that are non-empty. Pure — no active/focus concerns. */
export function normalizePanes<T extends { pane: PaneId }>(tabs: T[]): {
  tabs: T[]
  hasLeft: boolean
  hasRight: boolean
}
```

`normalizePanes` is the collapse/re-home primitive. Store close-actions call it, then
fix up `activeTabByPane`/`focusedPane` against the result.

---

## Store actions

### New actions

```ts
/** Split / "peel the active tab onto the other side." Deterministic rule (the button is
 *  disabled when the focused pane has no active tab, so the focused pane always has ≥1):
 *    src = focusedPane, dst = otherPane(src)
 *    if paneTabs(src).length >= 2:  move the active tab to dst, focus dst
 *    else (src has exactly 1 tab — moving would empty it): open a fresh query tab in dst
 *         (connection = the active tab's connection), focus dst
 *  then reselect src's active tab, normalize, mirror. Always yields a visible two-pane
 *  split (or, when already split, peels/adds onto the other side). */
splitActiveTab: () => void

/** Right-click "Move to other side." Move tab `id` across, focus the destination pane,
 *  reselect the source pane's active tab, then normalize (collapse/re-home). */
moveTabToOtherPane: (id: string) => void

/** Focus a pane (clicking its tab bar or body). No-op if the pane is empty. */
focusPane: (pane: PaneId) => void
```

### Changed actions (become pane-aware; all end with `withMirror`)

- **`openQueryTab` / `openDiagramTab` / `openOrLoadQuery` / `openTableQuery`** — the new
  tab is created with `pane: focusedPane`; that pane's `activeTabByPane`/`activeConnByPane`
  update. `openTableQuery` dedupe still scans **all** tabs; on a hit it calls
  `setActiveTab(existing.id)` which focuses whichever pane the match lives in.
- **`setActiveTab(id)`** — find the tab, set `focusedPane = tab.pane`,
  `activeTabByPane[tab.pane] = id`, `activeConnByPane[tab.pane] = tab.connectionId`,
  update `lastActiveByConnection`, mirror.
- **`setActiveConnection(id)`** — acts on `focusedPane`. Sets that pane's active
  connection; picks the connection's last-active tab **if it is in this pane**, else the
  first tab of that connection in this pane, else `null` (Welcome in that pane). Mirror.
  (`null` connection still clears to the no-selection state.)
- **`closeTab` / `closeTabsForConnection` / `closeOtherTabs` / `closeTabsToRight` /
  `closeTabsToLeft` / `closeAllTabs`** — remove the tab(s); for **each** pane whose active
  tab was removed, reselect via `nextActiveInPane`; run `normalizePanes`; if the result
  has no right tabs set `focusedPane='left'` and clear `activeTabByPane.right`/
  `activeConnByPane.right`; mirror. Drop a stale `commitModal` exactly as today.
  The within-group reselection from `applyGroupedTabClose` is reused, but scoped per
  pane (the close menu acts within the target tab's pane **and** connection group).
- **`hydrateTabs`** — see Persistence below.

`renameTab`, `setTabText`, `loadQueryText`, run/script/edit actions: **unchanged** — they
key by tab id and never touch pane/active/focus.

---

## Components

### `App.tsx` — main area

```tsx
const splitView = tabs.some((t) => t.pane === 'right')
// ...
<main className="main">
  {tabs.length === 0 ? <Welcome /> : splitView ? (
    <div className="panes">
      <EditorPane paneId="left" />
      <PaneDivider />
      <EditorPane paneId="right" />
    </div>
  ) : (
    <EditorPane paneId="left" />
  )}
</main>
```

### `EditorPane` (new) — `src/renderer/src/components/EditorPane.tsx`

Extracts today's "TabBar + active content" block, scoped to one pane.

```tsx
function EditorPane({ paneId }: { paneId: PaneId }): JSX.Element {
  const focusedPane = useAppStore((s) => s.focusedPane)
  const activeId = useAppStore((s) => s.activeTabByPane[paneId])
  const focusPane = useAppStore((s) => s.focusPane)
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === activeId))
  const splitView = useAppStore((s) => s.tabs.some((t) => t.pane === 'right'))

  return (
    <div
      className={`editor-pane${splitView && paneId === focusedPane ? ' focused' : ''}`}
      onMouseDownCapture={() => focusPane(paneId)}
    >
      <TabBar pane={paneId} />
      {tab ? (
        tab.kind === 'diagram'
          ? <DiagramView key={tab.id} connectionId={tab.connectionId} />
          : <QueryTab key={tab.id} tab={tab} />
      ) : <Welcome />}
    </div>
  )
}
```

- `onMouseDownCapture` focuses the pane before any inner click handler runs.
- The `.focused` class shows the accent border **only while split** (single pane needs
  no focus affordance).

### `PaneDivider` (new) — `src/renderer/src/components/PaneDivider.tsx`

Vertical drag-to-resize, mirroring `QueryTab`'s editor/results divider but horizontal.
A new `src/renderer/src/lib/pane-split.ts` provides the pure math + storage seam
(localStorage key `pane-split`), structured exactly like `lib/split.ts`:

```ts
const KEY = 'pane-split'
export const DEFAULT_PANE_FRACTION = 0.5   // left pane width fraction
export const MIN_PANE_FRACTION = 0.2
export const MAX_PANE_FRACTION = 0.8
export function clampPaneFraction(f: number): number
export function dragPaneFraction(clientX: number, containerLeft: number, containerWidth: number): number
export function loadPaneFraction(storage?: Pick<Storage,'getItem'>): number
export function savePaneFraction(f: number, storage?: Pick<Storage,'setItem'>): void
```

The `.panes` container uses the fraction as the left pane's `flex-basis`
(`%` against the container width); the right pane is `flex: 1`.

### `TabBar.tsx` — gains a `pane: PaneId` prop

- `subtabs = tabs.filter(t => t.pane === pane && t.connectionId === activeConnByPane[pane])`.
- `groups = groupTabs(tabs.filter(t => t.pane === pane))` — the server-group row now only
  appears when **this pane** holds ≥2 connections (usually it won't → a flat strip).
- Active highlight uses `activeTabByPane[pane]`; group-row active uses `activeConnByPane[pane]`.
- The **`+`** button opens into this pane (calls `focusPane(pane)` then `openQueryTab`).
- New **Split** button (next to `+`): calls `splitActiveTab()`. Disabled when the pane has
  no active tab. Tooltip: *"Open this tab on the other side."*
- `setActiveConnection` group clicks act on the focused pane — clicking a group in a pane
  first `focusPane(pane)`.

### `TabContextMenu.tsx` — new item

Add **"Move to other side"** → `moveTabToOtherPane(tabId)`. Always enabled (moving the
only tab opens the split via the same edge-case rule). Existing close items unchanged.

---

## Sidebar, shortcuts — unchanged

- **Sidebar / `ObjectTree`**: reads `activeConnectionId` (focused-pane mirror) and calls
  `setActiveConnection` / `openTableQuery` — both already pane-aware via the store. No edits.
- **Global shortcuts** (`use-global-shortcuts.ts`): act on `activeTabId` (focused-pane
  mirror). `⌘W` → `closeTab(activeTabId)`, `⌘T` → `openQueryTab`, run, etc. all target the
  focused pane with **no code change**. (Optional, not in v1: `⌘1`/`⌘2` to focus left/right.)

---

## Session persistence

Restore the split layout across restarts.

- **Schema:** add a `pane` column to `session_tabs` —
  `ALTER TABLE session_tabs ADD COLUMN pane TEXT NOT NULL DEFAULT 'left'`, guarded by the
  existing column-exists migration pattern in `db.ts`.
- **`SessionTab`** gains `pane: PaneId`. The `active` flag is relaxed from "at most one"
  to **"at most one per pane"** (each side persists its own active tab).
- **`session.ts`** (`Row`, `toSessionTab`, `saveSessionTabs`): read/write the `pane` column.
- **`session-save.ts` `toSessionTabs(tabs, activeTabByPane)`**: signature changes from a
  single `activeTabId` to the per-pane map; flag each pane's active tab. Diagram tabs are
  still skipped (ephemeral).
- **`hydrateTabs`**: assign each tab its persisted `pane`; each pane's active tab = its
  flagged tab (else the pane's first tab); **`focusedPane` defaults to `'left'`** on
  restore (a deliberate simplification — we don't persist focus; left is always non-empty
  when tabs exist per invariant 1/2); derive `activeConnByPane` from each pane's active
  tab; mirror. Old sessions lacking `pane` default every tab to `left` (no split).
- **`use-session-persistence.ts`**: the change-detection guard also re-saves when
  `activeTabByPane` changes (moving a tab already mutates `s.tabs`, so that path is
  covered; add `s.activeTabByPane === prev.activeTabByPane` to the short-circuit).
- The **divider ratio** persists via its own `pane-split` localStorage key (like
  `editor-split`), not in sqlite.

---

## CSS — `styles.css`

- `.panes { display: flex; flex: 1; min-height: 0; }` — the two-pane container.
- `.editor-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; }`
  (left pane gets `flex: 0 0 <fraction>%` via inline style from the divider).
- `.editor-pane.focused .tabbar-wrap` — a subtle accent marking the focused side:
  `box-shadow: inset 0 2px 0 var(--accent)` on the tab bar (only rendered while split).
- `.pane-divider` — vertical grab strip mirroring the existing `.split-divider`
  (cursor `col-resize`, hover highlight, a few px wide).
- A small `.tab-split` button style next to `.tab-add`.

---

## Testing

Following the codebase style (pure-logic + store tests; no RTL):

**`lib/panes.test.ts`** (new):
- `otherPane`, `paneTabs` ordering.
- `nextActiveInPane`: after-index survivor preferred; falls back to before; null when pane emptied.
- `normalizePanes`: right-with-no-left re-homes all to left; right+left untouched; all-left untouched; empty input.

**`lib/pane-split.test.ts`** (new): clamp (NaN→default, out-of-range clamps), `dragPaneFraction` math, load/save round-trip with injected storage. (Mirror `split.test.ts`.)

**`state/store.test.ts`** (extend) — a `split views` describe:
- `splitActiveTab` with ≥2 tabs moves the active tab right + focuses right; with exactly 1 tab opens a fresh right tab and keeps the original left; both yield `splitView === true`.
- `moveTabToOtherPane` moves + focuses destination; reselects source active.
- collapse: closing the last right tab → all-left, `focusedPane==='left'`, `activeTabByPane.right===null`.
- re-home: closing the last left tab while right has tabs → right tabs become left, single pane.
- `focusPane` updates focus + mirror; no-op on empty pane.
- mirror invariant holds after split/move/focus/close/openQueryTab.
- `openQueryTab` opens into the focused pane (`pane === focusedPane`).
- `openTableQuery` dedupe focuses an existing tab in the **other** pane (no duplicate).
- `setActiveConnection` switches the **focused** pane's connection only.
- per-pane close reselection picks the adjacent tab **within the same pane**.

**`session-save.test.ts`** (extend) — `toSessionTabs` flags each pane's active tab and emits `pane`.
**`persistence/session.test.ts`** (extend) — `pane` column round-trips; default `left` for legacy rows.
**`state/store.test.ts`** hydrate — restores `pane`, both panes' active tabs, `focusedPane==='left'`; legacy tabs (no pane) load as a single left pane.

---

## File-by-file change summary

**New**
- `src/renderer/src/lib/panes.ts` (+ `panes.test.ts`)
- `src/renderer/src/lib/pane-split.ts` (+ `pane-split.test.ts`)
- `src/renderer/src/components/EditorPane.tsx`
- `src/renderer/src/components/PaneDivider.tsx`

**Modified**
- `src/renderer/src/state/store.ts` — `pane` field, per-pane state, mirror helper, new + pane-aware actions.
- `src/renderer/src/App.tsx` — split layout / `EditorPane` extraction (`AppShell`'s `<main>`).
- `src/renderer/src/components/TabBar.tsx` — `pane` prop + Split button.
- `src/renderer/src/components/TabContextMenu.tsx` — "Move to other side."
- `src/renderer/src/lib/session-save.ts` — `toSessionTabs(tabs, activeTabByPane)` + `pane`.
- `src/renderer/src/lib/use-session-persistence.ts` — pass `activeTabByPane`; guard.
- `src/shared/domain.ts` — `SessionTab.pane`; relax `active` doc to "one per pane."
- `src/main/persistence/session.ts` — `pane` column read/write.
- `src/main/persistence/db.ts` — `session_tabs.pane` migration.
- `src/renderer/src/styles.css` — `.panes`, `.editor-pane`, `.pane-divider`, focus accent, split button.

**Unchanged (by design):** `ObjectTree.tsx`, `use-global-shortcuts.ts`, `tab-groups.ts`
(reused as-is, scoped per pane), `QueryTab.tsx`, `DiagramView.tsx`.

---

## Edge cases

- **Split with one tab:** opens a fresh tab on the other side (handled in `splitActiveTab`).
- **Closing across collapse:** re-home keeps the left pane canonical; focus resets to left.
- **Diagram tab in a pane:** renders normally; one diagram tab per connection still holds
  (dedupe is global). A diagram can sit on one side, a table on the other.
- **`openTableQuery` dedupe** focuses the existing tab in whichever pane it lives in.
- **Deleting a connection** (`closeTabsForConnection`) may empty a pane → normalize collapses it.
- **Sidebar selection** only ever affects the focused pane — the other side stays put.
