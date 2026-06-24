# Drag a tab onto the editor body to split — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming)
**Branch:** `feat/schema-diagram`.

## Goal

Extend tab drag-and-drop so dragging a tab onto the editor **body** (not the strip)
creates or targets a split:
- **Not split** (one pane): the body shows **left / right** drop zones. Drop on a side →
  the dragged tab goes to that side and **every other tab moves to the opposite side**.
- **Already split**: dropping a tab on a pane's body **moves it into that pane** (a big,
  easy target vs the thin strip).

Builds on the existing HTML5 tab DnD (`reorderTab`, `TAB_MIME`). Splits are still also
creatable with the `⊟` button and the strip still does precise reorder/cross-pane moves.

## Non-goals

- 3+ panes — an already-split body-drop *moves*, never makes a third pane.
- Drag-to-edge of the whole window / between connection groups.

## The drop-target problem

The editor body hosts Monaco / the results grid, which have their own drag handling. To
intercept the tab drag cleanly, each pane renders a **covering drop overlay**
(`pointer-events` on, above the content) *only while a tab drag is in progress*; it's not
rendered otherwise, so the content stays fully interactive. Detecting "a tab drag is in
progress" needs a one-bit signal — a transient `tabDragging` store flag. (A bare wrapper
with no overlay was rejected: Monaco/grid can swallow the drag events.)

## Design

### 1. Store — one flag + one new action; reuse the rest

- `tabDragging: boolean` + `setTabDragging(b)`. Transient (never persisted — session-save
  only serializes `tabs`/active). `TabBar` sets it on a tab's `onDragStart`/`onDragEnd`;
  `EditorPane`'s drop also clears it (in case `onDragEnd` is skipped when a collapse
  unmounts the source).
- **Already-split body-drop** reuses `reorderTab({ tabId, toPane: paneId, beforeId: null })`.
- **Not-split body-drop** → new `splitTabToSide({ tabId, side })`.

### 2. Pure `applyTabToSide` — `src/renderer/src/lib/tab-reorder.ts`

```ts
export function applyTabToSide<T extends { id: string; connectionId: string; pane: PaneId }>(
  tabs: T[],
  activeByPane: Record<PaneId, string | null>,
  focusedPane: PaneId,
  arg: { tabId: string; side: PaneId }
): { tabs: T[]; activeByPane: Record<PaneId, string | null>; focusedPane: PaneId }
```

- Set the dragged tab's `pane = side`; set **every other tab's** `pane = otherPane(side)`.
- No-op (return inputs, same refs) if the id is unknown or no pane actually changed.
- `normalizePanes` (so a single tab can't split — it re-homes to left); the moved tab is
  active in its final pane; the other pane keeps the previously-focused tab if it landed
  there, else its first tab. `focusedPane = norm.hasRight ? movedPane : 'left'`.
- Mirrors `applyTabReorder`'s return shape; the store derives `activeConnByPane`.

Also: **move `TAB_MIME`** (`'application/x-ganesha-tab'`) from `TabBar` into
`tab-reorder.ts` and export it, so `TabBar` and `EditorPane` share it.

### 3. Store action `splitTabToSide`

Wraps `applyTabToSide` + `connFor` (recompute each pane's connection from the survivor — the
same anti-stale pattern as `reorderTab`) + `withMirror`; short-circuits on the no-op ref.

### 4. `EditorPane` — body wrapper + overlay

Wrap the content in `.editor-pane-body` (`position: relative; flex: 1; min-height: 0;
display: flex; flex-direction: column` so `QueryTab`/`DiagramView`/`Welcome` still fill it).
While `tabDragging`, render `.pane-drop-overlay` (absolute, inset 0, above the content):
- `onDragOver` (if `TAB_MIME`): `preventDefault()`, `dropEffect = 'move'`; set the local
  `dropSide` — `'whole'` when `splitView`, else `'left' | 'right'` from pointer-x vs the body
  midpoint.
- `onDrop` (if `TAB_MIME`): read the id; `setTabDragging(false)`; if `splitView` →
  `reorderTab({ tabId, toPane: paneId, beforeId: null })`, else →
  `splitTabToSide({ tabId, side: dropSide })`.
- `onDragLeave`: clear `dropSide` only when truly leaving.
- Zones: split → one `.drop-zone.whole` ("Move here"); not split → two `.drop-zone`
  halves (left/right) with "Split left/right" labels; the `dropSide` one gets `.active`.

### 5. CSS — `styles.css`

`.editor-pane-body` (flex column, relative); `.pane-drop-overlay` (absolute inset 0, flex,
z-index above the content); `.drop-zone` (flex: 1, centered label, transparent dashed
border); `.drop-zone.active` (accent tint + border); `.drop-zone-label` (chip, shown only
when active).

### 6. Testing

`lib/tab-reorder.test.ts` (extend):
- `applyTabToSide`: tab→side + others→other side ⇒ split (both panes populated), dragged
  active on `side`, the other pane keeps the previously-active tab;
- one-tab input ⇒ no split (re-homes to left), and the `side='left'` single-tab case is a
  no-op;
- a move that changes nothing ⇒ inputs unchanged;
- multi-connection: the other pane's active is a real tab so the store's `activeConnByPane`
  is correct.

Store test: `splitTabToSide` focuses the dragged tab, splits, and keeps `activeConnByPane`
consistent (not stale) for a multi-connection pane.

Overlay/drag interactions are manually verified (no RTL), like the existing tab DnD.
Renderer-only; no driver / IPC / contract changes.
