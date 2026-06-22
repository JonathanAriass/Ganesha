# Tabs grouped by server — design

**Goal:** Show query tabs grouped by the connection (server) they belong to: a top-level row of
server groups, and below it the subtabs (query tabs) of the selected group.

## Current state

`tabs: QueryTabData[]` is a flat list; each tab carries `connectionId`. `TabBar` renders all tabs
in one strip. `activeTabId` (active tab) and `activeConnectionId` (active connection, drives the
sidebar object tree / saved / history) are tracked independently and can point at different
connections. `setActiveConnection` is called from the TopBar dropdown, ⌘K palette, and connection
save/delete. The app allows zero tabs (`activeTabId` → null → Welcome).

## Model — groups are a derived view; the active connection IS the group

No parallel data structure. The top level is *derived* by grouping the flat `tabs` array by
`connectionId` (ordered by first appearance). The **active group = `activeConnectionId`**, with the
invariant: *when the active connection has any open tabs, `activeTabId` is one of them.* This unifies
the active connection (sidebar/saved/history/⌘K all key off `activeConnectionId`) with the group on
screen — selecting a group switches everything.

A small ephemeral `lastActiveByConnection: Record<connectionId, tabId>` remembers the last-active tab
per group (not persisted; the session's `active` flag already restores the active tab → active group).

## Behaviors

- **Click a group** → activate that connection's last-active tab (`lastActiveByConnection`, fallback
  to its first tab); the sidebar follows because `activeConnectionId` changes.
- **Click a subtab** → `setActiveTab`, which now also sets `activeConnectionId` to the tab's
  connection and updates the memory map.
- **Open a tab** (`+` / sidebar double-click / saved query / ⌘K) → also sets `activeConnectionId`.
- **Switch connection in the sidebar/TopBar/⌘K** (`setActiveConnection(connId)`) → activate that
  group's last-active tab if it has any; otherwise `activeTabId = null` (empty subtab row + Welcome).
  `setActiveConnection(null)` → both null.
- **Per-group close** — the right-click subtab menu (Close / others / right / left / all) operates
  **within that subtab's group**: "Close all" closes that group. If a group empties, the active tab
  falls to the first remaining tab of another group, else null.

## Layout

`TabBar` gains a top `.tab-groups` row: one chip per connection group — color dot + connection name +
tab count, active highlighted, click to select. **Shown only when ≥2 groups have tabs** (one server
looks exactly like today). The existing subtab row renders only the active group's tabs.

## Pure, tested logic (`lib/tab-groups.ts`)

- `groupTabs(tabs)` → `{ connectionId, tabs }[]`, ordered by first appearance.
- `nextActiveForGroup(tabs, connId, lastActiveByConnection)` → the tab id to activate when switching
  to `connId`: the remembered tab if it's still in the group, else the group's first tab, else null.
- `applyGroupedTabClose(tabs, activeId, mode, targetId)` → `{ tabs, activeId }` where
  `mode ∈ 'self'|'others'|'right'|'left'|'all'`: scope the close to the target's group (the survivor
  set reuses `applyTabClose` on the group slice — `'self'` added there = close just the target),
  recombine survivors with the other groups' tabs preserving order, and reselect — **keep the active
  tab if it survives** (incl. when it was in another group); else (the active tab was closed) the
  **nearest surviving tab in the group** (the one after the target, else before); else the **first
  remaining tab** in another group; else null.

## Store changes

`lastActiveByConnection` state; extend `setActiveTab` (sets `activeConnectionId` + map), extend
`setActiveConnection` (activates the group's tab via `nextActiveForGroup`), `openQueryTab` sets
`activeConnectionId`. **All closes route through `applyGroupedTabClose`**: `closeTab` (the `×` / ⌘W /
menu "Close") with mode `'self'` (group-aware adjacent reselection); the four menu actions with their
modes. The `commitModal`-stale-clear invariant is preserved in every close action.

## Out of scope (YAGNI)

Drag tabs between groups; manual reordering; a close button on the group chip (the subtab "Close all"
covers it); persisting `lastActiveByConnection`.

## Testing

`lib/tab-groups.ts` unit-tested: grouping order, `nextActiveForGroup` (remembered/first/none),
`applyGroupedTabClose` for every mode incl. emptying a group and active-in-another-group. The
two-level wiring and the sidebar unification verified live. Pure renderer — integration unaffected.
