# Tab close operations — design

**Goal:** Right-click a query tab to close all tabs, the tabs to its right, the tabs to its
left, the other tabs, or just it.

## Current state

`TabBar.tsx` renders the tabs; a per-tab `×` calls `closeTab(id)`. The store's `closeTab` and
`closeTabsForConnection` set the pattern: filter the `tabs` array, re-select the active tab if it
was closed, and drop a `commitModal` whose tab is gone. The app allows zero tabs (`activeTabId`
→ null). Closing a tab discards its staged result-edits silently.

## Behavior

Right-click (`onContextMenu`) a tab → a context menu at the cursor, scoped to that tab:

- **Close** — this tab (existing `closeTab`)
- **Close others** — every tab except this one
- **Close to the right** — tabs after this one *(disabled when it's the last tab)*
- **Close to the left** — tabs before this one *(disabled when it's the first tab)*
- **Close all**

The menu closes on item click, outside-click, or Escape. Closing discards staged edits silently
(same as the single-tab `×` today) — no confirm dialog, no new keyboard shortcuts.

## Implementation

**Pure module `lib/tab-close.ts`** (unit-tested):

```ts
export type CloseMode = 'others' | 'right' | 'left' | 'all'

export function applyTabClose<T extends { id: string }>(
  tabs: T[], activeId: string | null, mode: CloseMode, targetId: string,
): { tabs: T[]; activeId: string | null }
```

- `idx = tabs.findIndex(id === targetId)`; if `idx === -1` and mode ≠ `'all'` → no-op (return inputs).
- Survivors: `all` → `[]`; `others` → only the target; `right` → `tabs.slice(0, idx+1)`; `left` → `tabs.slice(idx)`.
- Next active: the current active if it survives; else the target if it survives; else the first
  remaining; else null.

**Store actions** — `closeAllTabs()`, `closeOtherTabs(id)`, `closeTabsToRight(id)`,
`closeTabsToLeft(id)`. Each calls `applyTabClose`, then sets `{ tabs, activeTabId, commitModal }`
where `commitModal` is kept only if its tab survives (mirrors `closeTab`).

**`TabContextMenu.tsx`** — a fixed-position menu at `{x, y}` with the five items (right/left
disabled at the edges), an Escape/outside-click-to-close backdrop, and `onSelect(action)`.

**`TabBar.tsx`** — each tab gets `onContextMenu={(e) => { e.preventDefault(); openMenu(tab.id, e.clientX, e.clientY) }}`; local `useState` holds the open menu `{ tabId, x, y }`; selecting an item dispatches the matching store action and closes the menu.

**CSS** — `.tab-menu` (fixed, themed, small) + `.tab-menu-item` (+ disabled state) in `styles.css`.

## Out of scope (YAGNI)

Confirm dialog for discarding uncommitted edits (single-tab close already discards silently);
keyboard shortcuts (⌘W still closes the active tab); reopen-closed-tab.

## Testing

`lib/tab-close.ts` unit-tested across all modes, active-tab positions, and edges (first/last/single
tab, unknown id, active among the closed). Menu wiring verified live. Pure renderer — integration
suite unaffected.
