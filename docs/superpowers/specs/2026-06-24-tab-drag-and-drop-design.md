# Tab drag-and-drop (reorder + move between panes) — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming)
**Branch:** `feat/schema-diagram`.

## Goal

Let the user **drag a tab to reorder it** within its pane's strip, and **drag a tab
across into the other pane** (when split) to move it there — a fluid complement to the
existing right-click "Move to other side". Splits are still created with the `⊟` button.

## Non-goals (YAGNI)

- Drag-to-edge to *create* a split (the `⊟` button does that).
- Dragging between connection groups (a tab's connection is fixed).

## Mechanism

**HTML5 Drag-and-Drop API** (no dependency; Electron is Chromium so no cross-browser
quirks). Cross-pane works for free: the dragged tab's id rides in `dataTransfer`, so the
other pane's strip reads it on drop — no shared drag state needed.

## Design

### 1. Pure relocation — `src/renderer/src/lib/tab-reorder.ts` (new, tested)

```ts
import { type PaneId, normalizePanes } from './panes'

export interface TabMove { tabId: string; toPane: PaneId; beforeId: string | null }

/** Relocate `tabId` to `toPane`, inserted before `beforeId` (or appended to the end of the
 *  flat array — i.e. last in that pane's strip — when beforeId is null/absent/itself), then
 *  enforce the pane invariants and report each pane's new active tab + focus. The moved tab
 *  becomes active in its final pane; a move that empties a side collapses/re-homes exactly
 *  like applyPaneClose. No-op (returns the inputs unchanged, same refs) when the id is
 *  unknown or the order is unchanged. Mirrors applyPaneClose's return shape — the store
 *  derives activeConnByPane from the active tab ids. */
export function applyTabReorder<T extends { id: string; connectionId: string; pane: PaneId }>(
  tabs: T[],
  activeByPane: Record<PaneId, string | null>,
  focusedPane: PaneId,
  move: TabMove
): { tabs: T[]; activeByPane: Record<PaneId, string | null>; focusedPane: PaneId }
```

Algorithm:
1. `src = tabs.find(id === tabId)`; if absent or `beforeId === tabId` → return inputs unchanged.
2. `without = tabs.filter(id !== tabId)`; `moved = { ...src, pane: toPane }`.
   Insert `moved` before `beforeId` in `without` if that id is present, else append at the end.
3. If the resulting `(id, pane)` sequence equals the original → return inputs unchanged (no-op).
4. `norm = normalizePanes(next)` (collapse: right-empty ⇒ all left; left-empty-while-right ⇒
   re-home). `movedPane =` the moved tab's pane in `norm.tabs`.
5. Active per pane: the moved tab is active in `movedPane`; the other pane keeps its active if
   it still lives there, else its first tab, else null. `focusedPane = norm.hasRight ?
   movedPane : 'left'`.

### 2. Store action `reorderTab(move: TabMove)` — `state/store.ts`

Wraps `applyTabReorder`, derives `activeConnByPane` from the returned active tab ids
(`connFor`, the multi-connection-safe way), and spreads `withMirror`. No-op short-circuit
when the helper returns the original `tabs`. (`moveTabToOtherPane` stays for the menu.)

### 3. `TabBar` wiring (HTML5 DnD)

Each tab `<button>` gains `draggable` and:
- `onDragStart` → `e.dataTransfer.setData(TAB_MIME, tab.id)`, `effectAllowed = 'move'`;
  local `dragging` state set to `tab.id` (dims the source via `.tab.dragging`).
- `onDragOver` (per tab) → if the drag carries `TAB_MIME`, `preventDefault()` (accept the
  drop) and set local `dropBeforeId` from pointer-x vs the tab's horizontal midpoint
  (left half → this tab's id; right half → the next tab's id, or `null` at the end). A
  `.tab-drop-before` indicator renders at that position. The empty strip area → `null`.
- `onDrop` (on the `.tabbar`) → read the id from `dataTransfer`; dispatch
  `reorderTab({ tabId: id, toPane: pane, beforeId: dropBeforeId })`; clear drag state.
- `onDragEnd` → clear `dragging`/`dropBeforeId`.

`dropBeforeId` skips the dragged tab itself (no self-drop). The strip's `.tabbar` carries
`onDragOver`/`onDrop` so a drop on empty space (or the other pane) is handled; cross-pane
"just works" because the other pane's `TabBar` is its own drop target reading the same id.

### 4. Free wins / interactions

- **Persistence:** reorder/move only mutates the `tabs` array, so session-save persists the
  new order + pane via the existing throttled subscription — no persistence change.
- **Rename:** a drag never fires `dblclick`, and a tab being renamed renders the input (not a
  draggable button), so rename and drag don't collide.
- **Single pane:** reorder works with no split; there's just no other pane to cross into.

### 5. CSS — `styles.css`

- `.tab.dragging { opacity: .5 }` — dim the source.
- `.tab-drop-before` — a thin vertical accent bar marking the insertion point (absolute, on
  the left edge of the target tab; the strip cell is `position: relative`).

### 6. Testing

`lib/tab-reorder.test.ts` (pure):
- reorder within a pane (move middle → end, → front);
- `beforeId` null → append (last in the strip);
- same-position drop and `beforeId === tabId` → no-op (inputs returned unchanged);
- unknown `tabId` → no-op;
- move across panes (tab changes pane, becomes active there);
- **move the active tab across when the source pane has other connections' tabs → the source
  pane's active reselects a survivor and its `activeConnByPane` is NOT left stale** (the same
  class of bug caught in `moveTabToOtherPane` review);
- move the **last** tab off a side → collapse/re-home to a single left pane.

Plus a store-action test: `reorderTab` focuses the moved tab + maintains the mirror.

The drag interactions themselves are manually verified (no RTL in this codebase).

Renderer-only; no driver / IPC / contract changes.
