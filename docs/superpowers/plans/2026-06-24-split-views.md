# Split Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user view two query/table tabs side by side in the main area — same connection or two different connections — via two independent editor groups with a draggable vertical divider.

**Architecture:** Keep the flat `tabs: QueryTabData[]` array and add a `pane: 'left'|'right'` field per tab. The store gains per-pane active-tab/connection maps and a focused pane; `activeTabId`/`activeConnectionId` become focused-pane *mirrors* so the sidebar, shortcuts, and persistence need no changes. Split is derived (`tabs.some(t => t.pane==='right')`). Pure helpers in `lib/panes.ts` hold the collapse/re-home/close rules; `TabBar` and `QueryTab` are reused per-pane inside a new `EditorPane`.

**Tech Stack:** Electron + React 18 + TypeScript, Zustand store, Vitest (no RTL — pure-logic + store tests), better-sqlite3 for session persistence.

**Spec:** `docs/superpowers/specs/2026-06-24-split-views-design.md`

**Branch:** continue on the current `feat/schema-diagram` branch (this work layers on top of it).

---

## File Structure

**New files**
- `src/renderer/src/lib/panes.ts` — pure pane helpers: `otherPane`, `paneTabs`, `nextActiveInPane`, `normalizePanes`, `applyPaneClose`. Owns every tricky collapse/re-home/close rule.
- `src/renderer/src/lib/panes.test.ts` — unit tests for the above.
- `src/renderer/src/lib/pane-split.ts` — pure divider math + localStorage seam (mirrors `lib/split.ts`).
- `src/renderer/src/lib/pane-split.test.ts` — unit tests.
- `src/renderer/src/components/EditorPane.tsx` — one pane: its `TabBar` + active tab content. Reused for both sides.
- `src/renderer/src/components/PaneDivider.tsx` — vertical drag-to-resize between the two panes.

**Modified files**
- `src/renderer/src/state/store.ts` — `pane` field, per-pane state, `withMirror`, `blankTab` factory, new + pane-aware actions.
- `src/renderer/src/state/store.test.ts` — extend with a `split views` describe; update existing resets/assertions for the new fields.
- `src/renderer/src/App.tsx` — render one or two `EditorPane`s.
- `src/renderer/src/components/TabBar.tsx` — `pane` prop; Split button; "Move to other side" wiring.
- `src/renderer/src/components/TabContextMenu.tsx` — "Move to other side" item.
- `src/renderer/src/lib/session-save.ts` — `toSessionTabs(tabs, activeTabByPane)` + `pane`.
- `src/renderer/src/lib/session-save.test.ts` — update for the new signature + `pane`.
- `src/renderer/src/lib/use-session-persistence.ts` — pass `activeTabByPane`; broaden change guard.
- `src/shared/domain.ts` — `SessionTab.pane`; relax the `active` doc comment.
- `src/main/persistence/session.ts` — read/write the `pane` column.
- `src/main/persistence/session.test.ts` — `pane` round-trip + legacy default.
- `src/main/persistence/db.ts` — `session_tabs.pane` migration.
- `src/renderer/src/styles.css` — `.panes`, `.editor-pane`, `.editor-pane.focused`, `.pane-divider`, `.tab-split`.

---

## Conventions used by every task

- Typecheck the renderer: `npm run typecheck:web`
- Lint: `npm run lint`
- Run one test file: `npx vitest run <path>`
- Run all unit tests: `npx vitest run`
- `PaneId` is `'left' | 'right'`. It is declared once in `lib/panes.ts` and imported everywhere else.
- Commit messages use the repo's conventional style (`feat:`, `test:`, `refactor:`).

---

## Task 1: Pure pane helpers — `lib/panes.ts`

**Files:**
- Create: `src/renderer/src/lib/panes.ts`
- Test: `src/renderer/src/lib/panes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/panes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { otherPane, paneTabs, nextActiveInPane, normalizePanes, applyPaneClose } from './panes'

type T = { id: string; connectionId: string; pane: 'left' | 'right' }
const t = (id: string, pane: 'left' | 'right', connectionId = 'c1'): T => ({ id, connectionId, pane })

describe('otherPane', () => {
  it('flips left/right', () => {
    expect(otherPane('left')).toBe('right')
    expect(otherPane('right')).toBe('left')
  })
})

describe('paneTabs', () => {
  it('keeps only a pane’s tabs, order preserved', () => {
    const tabs = [t('a', 'left'), t('b', 'right'), t('c', 'left')]
    expect(paneTabs(tabs, 'left').map((x) => x.id)).toEqual(['a', 'c'])
    expect(paneTabs(tabs, 'right').map((x) => x.id)).toEqual(['b'])
  })
})

describe('nextActiveInPane', () => {
  it('prefers the survivor after the removed tab', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('c', 'left')]
    expect(nextActiveInPane(tabs, 'left', 'b')).toBe('c') // c is after b
  })
  it('falls back to the survivor before when none follow', () => {
    const tabs = [t('a', 'left'), t('b', 'left')]
    expect(nextActiveInPane(tabs, 'left', 'b')).toBe('a')
  })
  it('ignores the other pane and returns null when the pane is empty', () => {
    const tabs = [t('a', 'right')]
    expect(nextActiveInPane(tabs, 'left', 'x')).toBeNull()
  })
})

describe('normalizePanes', () => {
  it('re-homes right tabs to left when left is empty', () => {
    const r = normalizePanes([t('a', 'right'), t('b', 'right')])
    expect(r.tabs.every((x) => x.pane === 'left')).toBe(true)
    expect(r.hasLeft).toBe(true)
    expect(r.hasRight).toBe(false)
  })
  it('leaves a genuine split untouched', () => {
    const r = normalizePanes([t('a', 'left'), t('b', 'right')])
    expect(r.tabs.map((x) => x.pane)).toEqual(['left', 'right'])
    expect(r.hasLeft && r.hasRight).toBe(true)
  })
  it('leaves an all-left set untouched', () => {
    const r = normalizePanes([t('a', 'left')])
    expect(r.hasRight).toBe(false)
    expect(r.tabs[0].pane).toBe('left')
  })
  it('reports both-empty for no tabs', () => {
    const r = normalizePanes([])
    expect(r).toEqual({ tabs: [], hasLeft: false, hasRight: false })
  })
})

describe('applyPaneClose', () => {
  const active = (l: string | null, r: string | null) => ({ left: l, right: r })

  it('self-close in a pane reselects the adjacent tab in that pane only', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'self', 'a')
    expect(r.tabs.map((t) => t.id)).toEqual(['b', 'x'])
    expect(r.activeByPane).toEqual({ left: 'b', right: 'x' }) // right untouched
    expect(r.focusedPane).toBe('left')
  })

  it('closing the last right tab collapses to a single left pane', () => {
    const tabs = [t('a', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'right', 'self', 'x')
    expect(r.tabs.map((t) => t.pane)).toEqual(['left'])
    expect(r.activeByPane).toEqual({ left: 'a', right: null })
    expect(r.focusedPane).toBe('left')
  })

  it('closing the last left tab re-homes the right tabs to left', () => {
    const tabs = [t('a', 'left'), t('x', 'right'), t('y', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'self', 'a')
    expect(r.tabs.every((t) => t.pane === 'left')).toBe(true)
    expect(r.tabs.map((t) => t.id)).toEqual(['x', 'y'])
    expect(r.activeByPane).toEqual({ left: 'x', right: null }) // former right-active
    expect(r.focusedPane).toBe('left')
  })

  it('"others" closes only within the target’s pane + connection', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'others', 'b')
    expect(r.tabs.map((t) => t.id)).toEqual(['b', 'x']) // a closed, x (other pane) kept
    expect(r.activeByPane.left).toBe('b')
  })

  it('is a no-op for an unknown target', () => {
    const tabs = [t('a', 'left')]
    const r = applyPaneClose(tabs, active('a', null), 'left', 'self', 'nope')
    expect(r.tabs).toBe(tabs)
  })

  it('closing in the non-focused pane keeps focus put', () => {
    const tabs = [t('a', 'left'), t('b', 'left'), t('x', 'right')]
    const r = applyPaneClose(tabs, active('a', 'x'), 'left', 'self', 'x') // focus left, close right tab
    expect(r.focusedPane).toBe('left')
    expect(r.tabs.map((t) => t.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/lib/panes.test.ts`
Expected: FAIL — `panes.ts` does not exist / exports undefined.

- [ ] **Step 3: Implement `lib/panes.ts`**

Create `src/renderer/src/lib/panes.ts`:

```ts
import { applyTabClose, type CloseMode } from './tab-close'

/** Which side of a split a tab lives in. A string (not a union of more) only by
 *  YAGNI — widening to more panes later needs no structural change here. */
export type PaneId = 'left' | 'right'

export function otherPane(p: PaneId): PaneId {
  return p === 'left' ? 'right' : 'left'
}

/** A pane's tabs, display order preserved. */
export function paneTabs<T extends { pane: PaneId }>(tabs: T[], p: PaneId): T[] {
  return tabs.filter((t) => t.pane === p)
}

/** The tab to activate in `pane` after `removedId` leaves it: the nearest surviving
 *  tab in that pane (the one after the removed index, else the one before), else null. */
export function nextActiveInPane<T extends { id: string; pane: PaneId }>(
  tabs: T[],
  pane: PaneId,
  removedId: string
): string | null {
  const group = tabs.filter((t) => t.pane === pane)
  const idx = group.findIndex((t) => t.id === removedId)
  const survivors = group.filter((t) => t.id !== removedId)
  if (survivors.length === 0) return null
  if (idx === -1) return survivors[0].id
  const after = group.slice(idx + 1).find((t) => t.id !== removedId)
  const before = group.slice(0, idx).reverse().find((t) => t.id !== removedId)
  return (after ?? before ?? survivors[0]).id
}

/** Enforce the pane invariants: if there are right tabs but no left tabs, rewrite every
 *  tab to `left` (collapse the split). Returns the (possibly rewritten) tabs plus which
 *  panes are non-empty. Pure — knows nothing about active tabs or focus. */
export function normalizePanes<T extends { pane: PaneId }>(
  tabs: T[]
): { tabs: T[]; hasLeft: boolean; hasRight: boolean } {
  const hasLeft = tabs.some((t) => t.pane === 'left')
  const hasRight = tabs.some((t) => t.pane === 'right')
  if (hasRight && !hasLeft) {
    return { tabs: tabs.map((t) => ({ ...t, pane: 'left' as PaneId })), hasLeft: true, hasRight: false }
  }
  return { tabs, hasLeft, hasRight }
}

/** Close tab(s) scoped to the TARGET tab's pane + connection group, then keep the pane
 *  invariants and reselect each pane's active tab.
 *  - The close MODE (`self`/`others`/`right`/`left`/`all`) acts within the visible subtab
 *    set of the target's pane (same pane AND same connection) — exactly what the user sees.
 *  - The OTHER pane is never touched (its active tab stays put), unless a re-home collapses
 *    the split.
 *  - Reselection in the closed pane: keep its active tab if it survived; else the nearest
 *    survivor in the closed group; else the first remaining tab anywhere in that pane; else
 *    null.
 *  - Focus moves to the surviving pane only if the closed pane emptied; a collapse always
 *    lands on `left`. */
export function applyPaneClose<T extends { id: string; connectionId: string; pane: PaneId }>(
  tabs: T[],
  activeByPane: Record<PaneId, string | null>,
  focusedPane: PaneId,
  mode: CloseMode,
  targetId: string
): { tabs: T[]; activeByPane: Record<PaneId, string | null>; focusedPane: PaneId } {
  const target = tabs.find((t) => t.id === targetId)
  if (!target) return { tabs, activeByPane, focusedPane } // unknown target → no-op
  const tp = target.pane
  const conn = target.connectionId

  // Scope = the target pane's visible subtabs (pane + connection), in order.
  const scope = tabs.filter((t) => t.pane === tp && t.connectionId === conn)
  const kept = applyTabClose(scope, activeByPane[tp], mode, targetId).tabs
  const keptIds = new Set(kept.map((t) => t.id))
  const nextTabs = tabs.filter((t) => !(t.pane === tp && t.connectionId === conn) || keptIds.has(t.id))

  // Reselect the closed pane's active tab.
  const tpTabs = nextTabs.filter((t) => t.pane === tp)
  let tpActive: string | null
  if (activeByPane[tp] && tpTabs.some((t) => t.id === activeByPane[tp])) {
    tpActive = activeByPane[tp] // the active tab wasn't among those closed
  } else {
    // nearest survivor in the closed group, else first remaining tab in the pane
    const gIdx = scope.findIndex((t) => t.id === targetId)
    const after = scope.slice(gIdx + 1).find((t) => keptIds.has(t.id))
    const before = scope.slice(0, gIdx).reverse().find((t) => keptIds.has(t.id))
    tpActive = (after ?? before)?.id ?? tpTabs[0]?.id ?? null
  }

  const nextActive: Record<PaneId, string | null> = { ...activeByPane, [tp]: tpActive }

  // Keep the invariants. Re-home (right→left with empty left) collapses to one pane.
  const norm = normalizePanes(nextTabs)
  if (!norm.hasRight) {
    // Single left pane: if we re-homed, the survivors were the former RIGHT tabs, so the
    // left active becomes the former right active; otherwise it's the recomputed left active.
    const reHomed = nextTabs.some((t) => t.pane === 'right')
    const leftActive = reHomed ? nextActive.right : nextActive.left
    return { tabs: norm.tabs, activeByPane: { left: leftActive, right: null }, focusedPane: 'left' }
  }

  // Still split: focus follows only if the closed pane emptied (it can only be the non-`tp`
  // pane that survives here, since an empty left would have re-homed above).
  const tpEmpty = !norm.tabs.some((t) => t.pane === tp)
  return { tabs: norm.tabs, activeByPane: nextActive, focusedPane: tpEmpty ? otherPane(tp) : focusedPane }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/lib/panes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/panes.ts src/renderer/src/lib/panes.test.ts
git commit -m "feat(panes): pure pane helpers — split/collapse/close rules"
```

---

## Task 2: Divider math — `lib/pane-split.ts`

**Files:**
- Create: `src/renderer/src/lib/pane-split.ts`
- Test: `src/renderer/src/lib/pane-split.test.ts`

This mirrors `lib/split.ts` but for a horizontal (left/right) fraction.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/pane-split.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  clampPaneFraction,
  dragPaneFraction,
  loadPaneFraction,
  savePaneFraction,
  DEFAULT_PANE_FRACTION,
  MIN_PANE_FRACTION,
  MAX_PANE_FRACTION
} from './pane-split'

describe('clampPaneFraction', () => {
  it('heals garbage to the default', () => {
    expect(clampPaneFraction(NaN)).toBe(DEFAULT_PANE_FRACTION)
    expect(clampPaneFraction(Infinity)).toBe(DEFAULT_PANE_FRACTION)
  })
  it('clamps into range', () => {
    expect(clampPaneFraction(0)).toBe(MIN_PANE_FRACTION)
    expect(clampPaneFraction(1)).toBe(MAX_PANE_FRACTION)
    expect(clampPaneFraction(0.5)).toBe(0.5)
  })
})

describe('dragPaneFraction', () => {
  it('is the pointer offset into the container, clamped', () => {
    expect(dragPaneFraction(500, 0, 1000)).toBe(0.5)
    expect(dragPaneFraction(100, 100, 1000)).toBe(MIN_PANE_FRACTION) // 0 → clamps up
  })
  it('defaults on a zero-width container', () => {
    expect(dragPaneFraction(10, 0, 0)).toBe(DEFAULT_PANE_FRACTION)
  })
})

describe('load/save round-trip', () => {
  it('persists via injected storage', () => {
    const store: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v }
    }
    expect(loadPaneFraction(storage)).toBe(DEFAULT_PANE_FRACTION) // unset → default
    savePaneFraction(0.42, storage)
    expect(loadPaneFraction(storage)).toBe(0.42)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/lib/pane-split.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/pane-split.ts`**

Create `src/renderer/src/lib/pane-split.ts`:

```ts
/** Left/right split for the two editor panes: the fraction of the container width given
 *  to the LEFT pane (flex-basis %). Pure math + storage seam — PaneDivider owns the DOM.
 *  localStorage is the single source of truth (a pure UI preference), one global value. */

const KEY = 'pane-split'

export const DEFAULT_PANE_FRACTION = 0.5
export const MIN_PANE_FRACTION = 0.2
export const MAX_PANE_FRACTION = 0.8

export function clampPaneFraction(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_PANE_FRACTION
  return Math.min(MAX_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, f))
}

/** Where a drag at clientX puts the divider: the pointer's offset into the panes
 *  container, divided by the container width (what flex-basis % resolves against). */
export function dragPaneFraction(clientX: number, containerLeft: number, containerWidth: number): number {
  if (containerWidth <= 0) return DEFAULT_PANE_FRACTION
  return clampPaneFraction((clientX - containerLeft) / containerWidth)
}

export function loadPaneFraction(storage: Pick<Storage, 'getItem'> = localStorage): number {
  const raw = storage.getItem(KEY)
  if (raw === null) return DEFAULT_PANE_FRACTION
  return clampPaneFraction(Number(raw))
}

export function savePaneFraction(f: number, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(KEY, String(clampPaneFraction(f)))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/lib/pane-split.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/pane-split.ts src/renderer/src/lib/pane-split.test.ts
git commit -m "feat(panes): pane-split divider math (mirror of lib/split.ts)"
```

---

## Task 3: Store — pane state, mirror, pane-aware opens

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

This task adds the `pane` field + per-pane state and makes the existing open/activate
actions pane-aware while keeping `activeTabId`/`activeConnectionId` as focused-pane mirrors,
so all current behavior (and current tests) keep passing.

- [ ] **Step 1: Add imports + types + `blankTab` + `withMirror` to `store.ts`**

At the top of `src/renderer/src/state/store.ts`, add to the existing imports:

```ts
import { type PaneId, otherPane, normalizePanes, applyPaneClose } from '../lib/panes'
```

Add `pane` to the `QueryTabData` interface (after the `kind` field):

```ts
  /** Which side of a split this tab lives in. Defaults to `'left'`; only ever `'right'`
   *  while a split is open. `tabs.some(t => t.pane === 'right')` IS "is the view split". */
  pane: PaneId
```

Above `export const useAppStore`, add a tab factory and the mirror helper:

```ts
/** A fresh tab with every volatile field at its empty. Callers override what they need. */
function blankTab(fields: {
  connectionId: string
  title: string
  pane: PaneId
  text?: string
  kind?: 'query' | 'diagram'
  runOnOpen?: boolean
}): QueryTabData {
  return {
    id: crypto.randomUUID(),
    connectionId: fields.connectionId,
    title: fields.title,
    kind: fields.kind,
    pane: fields.pane,
    text: fields.text ?? '',
    epoch: 0,
    runOnOpen: fields.runOnOpen ?? false,
    running: false,
    queryId: null,
    result: null,
    error: null,
    scriptRun: null,
    edits: {},
    editError: null,
  }
}

/** Recompute the focused-pane mirrors (`activeTabId`/`activeConnectionId`) from the per-pane
 *  maps. Every action that changes panes/active/focus spreads this so the sidebar, global
 *  shortcuts, and persistence keep reading the two legacy fields unchanged. */
function withMirror<S extends {
  focusedPane: PaneId
  activeTabByPane: Record<PaneId, string | null>
  activeConnByPane: Record<PaneId, string | null>
}>(next: S): S & { activeTabId: string | null; activeConnectionId: string | null } {
  return {
    ...next,
    activeTabId: next.activeTabByPane[next.focusedPane],
    activeConnectionId: next.activeConnByPane[next.focusedPane],
  }
}
```

- [ ] **Step 2: Add the new state fields + action signatures to `AppState`**

In the `// ── Tabs ──` block of the `AppState` interface, add after `lastActiveByConnection`:

```ts
  focusedPane: PaneId
  activeTabByPane: Record<PaneId, string | null>
  activeConnByPane: Record<PaneId, string | null>
```

In the actions area of `AppState`, add:

```ts
  /** Peel the focused pane's active tab onto the other side (or, if that pane has only one
   *  tab, open a fresh tab on the other side). Always ends in a visible two-pane split. */
  splitActiveTab: () => void
  /** Move a specific tab to the other pane and focus the destination. */
  moveTabToOtherPane: (id: string) => void
  /** Focus a pane (no-op if it has no tabs). */
  focusPane: (pane: PaneId) => void
```

- [ ] **Step 3: Initialise the new fields**

In the `useAppStore` initial state object, after `lastActiveByConnection: {},` add:

```ts
  focusedPane: 'left',
  activeTabByPane: { left: null, right: null },
  activeConnByPane: { left: null, right: null },
```

- [ ] **Step 4: Rewrite `openQueryTab`, `openDiagramTab`, `setActiveTab`, `setActiveConnection` to be pane-aware**

Replace `openQueryTab`:

```ts
  openQueryTab: ({ connectionId, title, text, runOnOpen }) =>
    set((s) => {
      const n = s._queryCounter + 1
      const p = s.focusedPane
      const tab = blankTab({ connectionId, title: title ?? `Query ${n}`, text, runOnOpen, pane: p })
      return withMirror({
        tabs: [...s.tabs, tab],
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: tab.id },
        activeConnByPane: { ...s.activeConnByPane, [p]: connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [connectionId]: tab.id },
        _queryCounter: n,
      })
    }),
```

Replace `openDiagramTab`:

```ts
  openDiagramTab: (connectionId) =>
    set((s) => {
      // One diagram tab per connection — focus an existing one (in whichever pane) instead
      // of stacking duplicates.
      const existing = s.tabs.find((t) => t.connectionId === connectionId && t.kind === 'diagram')
      if (existing) {
        return withMirror({
          focusedPane: existing.pane,
          activeTabByPane: { ...s.activeTabByPane, [existing.pane]: existing.id },
          activeConnByPane: { ...s.activeConnByPane, [existing.pane]: connectionId },
          lastActiveByConnection: { ...s.lastActiveByConnection, [connectionId]: existing.id },
        })
      }
      const p = s.focusedPane
      const tab = blankTab({ connectionId, title: '◇ Schema', kind: 'diagram', pane: p })
      return withMirror({
        tabs: [...s.tabs, tab],
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: tab.id },
        activeConnByPane: { ...s.activeConnByPane, [p]: connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [connectionId]: tab.id },
      })
    }),
```

Replace `setActiveTab`:

```ts
  setActiveTab: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const p = tab.pane
      return withMirror({
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: id },
        activeConnByPane: { ...s.activeConnByPane, [p]: tab.connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [tab.connectionId]: id },
      })
    }),
```

Replace `setActiveConnection` (acts on the focused pane; `null` clears it):

```ts
  setActiveConnection: (id) =>
    set((s) => {
      const p = s.focusedPane
      if (id === null) {
        return withMirror({
          focusedPane: p,
          activeTabByPane: { ...s.activeTabByPane, [p]: null },
          activeConnByPane: { ...s.activeConnByPane, [p]: null },
        })
      }
      // Pick this connection's last-active tab if it lives in THIS pane, else the pane's first
      // tab for the connection, else null (empty group → Welcome in this pane).
      const inPane = s.tabs.filter((t) => t.pane === p && t.connectionId === id)
      const remembered = s.lastActiveByConnection[id]
      const tabId =
        (remembered && inPane.some((t) => t.id === remembered) && remembered) || inPane[0]?.id || null
      return withMirror({
        focusedPane: p,
        activeTabByPane: { ...s.activeTabByPane, [p]: tabId },
        activeConnByPane: { ...s.activeConnByPane, [p]: id },
        lastActiveByConnection: tabId ? { ...s.lastActiveByConnection, [id]: tabId } : s.lastActiveByConnection,
      })
    }),
```

> Note: `openOrLoadQuery` and `openTableQuery` call `loadQueryText`/`openQueryTab`/`setActiveTab`, all of which are now pane-aware, so they need **no change**. `nextActiveForGroup` is no longer used by `setActiveConnection`; leave it exported (still used by `tab-groups` tests) — remove its import from `store.ts` if it becomes unused to satisfy lint.

- [ ] **Step 5: Update existing store tests for the new fields**

In `src/renderer/src/state/store.test.ts`, several `beforeEach` blocks reset tab state. Update each tabs-resetting `beforeEach` to also reset the pane fields. Find every `useAppStore.setState({ tabs: [], activeTabId: null, ... })` and add the pane fields. For example the `openOrLoadQuery` and `openTableQuery` blocks become:

```ts
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })
```

Run the existing suites to confirm the mirror keeps them green:

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS (all existing tests, including `openTableQuery` and `openOrLoadQuery`).

- [ ] **Step 6: Add tests for pane-aware opens**

Append to `src/renderer/src/state/store.test.ts` a new describe:

```ts
describe('split views — opens target the focused pane', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('openQueryTab creates a left tab and mirrors active*', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'q' })
    const s = useAppStore.getState()
    expect(s.tabs[0].pane).toBe('left')
    expect(s.activeTabByPane.left).toBe(s.tabs[0].id)
    expect(s.activeTabId).toBe(s.tabs[0].id) // mirror
    expect(s.activeConnectionId).toBe('c1') // mirror
  })

  it('setActiveConnection switches only the focused pane', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', text: 'q' })
    useAppStore.setState({ focusedPane: 'right', activeConnByPane: { left: 'c1', right: null }, activeTabByPane: { left: useAppStore.getState().tabs[0].id, right: null } })
    useAppStore.getState().setActiveConnection('c2')
    const s = useAppStore.getState()
    expect(s.activeConnByPane.right).toBe('c2')
    expect(s.activeConnByPane.left).toBe('c1') // left untouched
    expect(s.activeConnectionId).toBe('c2') // mirror = focused (right)
  })
})
```

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors. (If `nextActiveForGroup` is now an unused import in `store.ts`, remove it from the import line.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "feat(store): per-pane tab state with focused-pane mirrors"
```

---

## Task 4: Store — split, move, focus actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `store.test.ts`:

```ts
describe('split views — split/move/focus', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('splitActiveTab peels the active tab to the right when the pane has ≥2 tabs', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' }) // B active, left
    const bId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab()
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === bId)!.pane).toBe('right')
    expect(s.tabs.some((t) => t.pane === 'right')).toBe(true) // split visible
    expect(s.focusedPane).toBe('right')
    expect(s.activeTabByPane.right).toBe(bId)
  })

  it('splitActiveTab opens a fresh tab on the other side when the pane has one tab', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    const aId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab()
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === aId)!.pane).toBe('left') // original stays
    expect(s.tabs.filter((t) => t.pane === 'right')).toHaveLength(1) // new tab on the right
    expect(s.focusedPane).toBe('right')
    expect(s.activeConnByPane.right).toBe('c1') // same connection
  })

  it('moveTabToOtherPane moves a tab and focuses the destination', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' })
    const aId = useAppStore.getState().tabs[0].id
    useAppStore.getState().moveTabToOtherPane(aId)
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === aId)!.pane).toBe('right')
    expect(s.focusedPane).toBe('right')
    expect(s.activeTabByPane.right).toBe(aId)
    expect(s.activeTabByPane.left).toBe(s.tabs.find((t) => t.title === 'B')!.id) // left reselected
  })

  it('focusPane is a no-op for an empty pane and switches focus + mirror otherwise', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().focusPane('right') // right empty → no-op
    expect(useAppStore.getState().focusedPane).toBe('left')
    useAppStore.getState().splitActiveTab() // now right has the fresh tab, focus right
    useAppStore.getState().focusPane('left')
    const s = useAppStore.getState()
    expect(s.focusedPane).toBe('left')
    expect(s.activeTabId).toBe(s.activeTabByPane.left) // mirror follows focus
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "split/move/focus"`
Expected: FAIL — actions undefined.

- [ ] **Step 3: Implement the actions**

Add to the store object (e.g. right after `setActiveTab`):

```ts
  splitActiveTab: () =>
    set((s) => {
      const src = s.focusedPane
      const dst = otherPane(src)
      const activeId = s.activeTabByPane[src]
      if (!activeId) return s // button is disabled in this state, but guard anyway
      const srcCount = s.tabs.filter((t) => t.pane === src).length
      if (srcCount >= 2) {
        // Peel the active tab across.
        const tabs = s.tabs.map((t) => (t.id === activeId ? { ...t, pane: dst } : t))
        const moved = tabs.find((t) => t.id === activeId)!
        return withMirror({
          tabs,
          focusedPane: dst,
          activeTabByPane: {
            ...s.activeTabByPane,
            [src]: nextActiveInPaneLike(tabs, src, activeId),
            [dst]: activeId,
          },
          activeConnByPane: { ...s.activeConnByPane, [dst]: moved.connectionId },
        })
      }
      // Source has a single tab — open a fresh one on the other side instead (keeps the split).
      const moved = s.tabs.find((t) => t.id === activeId)!
      const n = s._queryCounter + 1
      const tab = blankTab({ connectionId: moved.connectionId, title: `Query ${n}`, pane: dst })
      return withMirror({
        tabs: [...s.tabs, tab],
        focusedPane: dst,
        activeTabByPane: { ...s.activeTabByPane, [dst]: tab.id },
        activeConnByPane: { ...s.activeConnByPane, [dst]: moved.connectionId },
        lastActiveByConnection: { ...s.lastActiveByConnection, [moved.connectionId]: tab.id },
        _queryCounter: n,
      })
    }),

  moveTabToOtherPane: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const src = tab.pane
      const dst = otherPane(src)
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, pane: dst } : t))
      // Reselect the source pane's active if we moved its active tab; normalize for collapse.
      const srcActive = s.activeTabByPane[src] === id ? nextActiveInPaneLike(tabs, src, id) : s.activeTabByPane[src]
      const norm = normalizePanes(tabs)
      const reHomed = !norm.hasRight && tabs.some((t) => t.pane === 'right')
      if (!norm.hasRight) {
        // Moving emptied a pane and collapsed — everything is left now.
        return withMirror({
          tabs: norm.tabs,
          focusedPane: 'left',
          activeTabByPane: { left: reHomed ? id : (srcActive ?? id), right: null },
          activeConnByPane: { ...s.activeConnByPane, left: tab.connectionId, right: null },
        })
      }
      return withMirror({
        tabs: norm.tabs,
        focusedPane: dst,
        activeTabByPane: { ...s.activeTabByPane, [src]: srcActive, [dst]: id },
        activeConnByPane: { ...s.activeConnByPane, [dst]: tab.connectionId },
      })
    }),

  focusPane: (pane) =>
    set((s) => {
      if (!s.tabs.some((t) => t.pane === pane)) return s // empty pane can't take focus
      return withMirror({
        focusedPane: pane,
        activeTabByPane: s.activeTabByPane,
        activeConnByPane: s.activeConnByPane,
      })
    }),
```

Add the small helper next to `blankTab` (a thin wrapper so the store doesn't import `nextActiveInPane` under two names):

```ts
import { type PaneId, otherPane, normalizePanes, applyPaneClose, nextActiveInPane } from '../lib/panes'
// ...
const nextActiveInPaneLike = nextActiveInPane
```

> Simpler: import `nextActiveInPane` directly and call it (drop the alias). Use whichever keeps lint happy; the alias only exists to make the intent obvious in the actions above.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "feat(store): splitActiveTab / moveTabToOtherPane / focusPane"
```

---

## Task 5: Store — pane-aware close family

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

Route the close actions through `applyPaneClose` so closing in one pane never disturbs the
other, and a collapse keeps the invariants.

- [ ] **Step 1: Write the failing tests**

Append to `store.test.ts`:

```ts
describe('split views — close', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {}, commitModal: null,
    })
  })

  function splitTwo() {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' })
    const bId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab() // B → right, focus right
    return { aId: useAppStore.getState().tabs.find((t) => t.title === 'A')!.id, bId }
  }

  it('closing the last right tab collapses to one left pane', () => {
    const { aId, bId } = splitTwo()
    useAppStore.getState().closeTab(bId)
    const s = useAppStore.getState()
    expect(s.tabs.map((t) => t.pane)).toEqual(['left'])
    expect(s.tabs[0].id).toBe(aId)
    expect(s.focusedPane).toBe('left')
    expect(s.activeTabByPane.right).toBeNull()
    expect(s.activeTabId).toBe(aId) // mirror
  })

  it('closing a left tab while right has tabs keeps the split and reselects left', () => {
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'A', text: 'a' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'B', text: 'b' })
    useAppStore.getState().openQueryTab({ connectionId: 'c1', title: 'C', text: 'c' }) // A,B,C left, C active
    const cId = useAppStore.getState().activeTabId!
    useAppStore.getState().splitActiveTab() // C → right
    const aId = useAppStore.getState().tabs.find((t) => t.title === 'A')!.id
    useAppStore.getState().focusPane('left')
    useAppStore.getState().closeTab(aId)
    const s = useAppStore.getState()
    expect(s.tabs.some((t) => t.id === cId && t.pane === 'right')).toBe(true) // still split
    expect(s.activeTabByPane.left).toBe(s.tabs.find((t) => t.title === 'B')!.id)
  })

  it('closing the last left tab re-homes the right tabs to left', () => {
    const { bId } = splitTwo() // A left, B right
    useAppStore.getState().focusPane('left')
    const aId = useAppStore.getState().tabs.find((t) => t.title === 'A')!.id
    useAppStore.getState().closeTab(aId)
    const s = useAppStore.getState()
    expect(s.tabs.every((t) => t.pane === 'left')).toBe(true)
    expect(s.tabs.map((t) => t.id)).toEqual([bId])
    expect(s.focusedPane).toBe('left')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "split views — close"`
Expected: FAIL — current `closeTabsResult` ignores panes (right tab close leaves a stale split / wrong active).

- [ ] **Step 3: Rewrite `closeTabsResult` and the close actions**

Replace the `closeTabsResult` helper near the top of `store.ts`:

```ts
/** Apply a pane-aware bulk close and drop a commit modal whose tab no longer survives. */
function closeTabsResult(
  s: AppState,
  mode: CloseMode,
  targetId: string
): Pick<AppState, 'tabs' | 'activeTabId' | 'activeConnectionId' | 'commitModal' | 'focusedPane' | 'activeTabByPane' | 'activeConnByPane'> {
  const r = applyPaneClose(s.tabs, s.activeTabByPane, s.focusedPane, mode, targetId)
  // Each pane's active connection follows its (possibly new) active tab.
  const connFor = (id: string | null): string | null =>
    id ? (r.tabs.find((t) => t.id === id)?.connectionId ?? null) : null
  const activeConnByPane = { left: connFor(r.activeByPane.left), right: connFor(r.activeByPane.right) }
  return withMirror({
    ...{
      tabs: r.tabs,
      focusedPane: r.focusedPane,
      activeTabByPane: r.activeByPane,
      activeConnByPane,
      commitModal: r.tabs.some((t) => t.id === s.commitModal?.tabId) ? s.commitModal : null,
    },
  }) as Pick<AppState, 'tabs' | 'activeTabId' | 'activeConnectionId' | 'commitModal' | 'focusedPane' | 'activeTabByPane' | 'activeConnByPane'>
}
```

The six close actions (`closeTab`, `closeOtherTabs`, `closeTabsToRight`, `closeTabsToLeft`,
`closeAllTabs`) already delegate to `closeTabsResult` — they need **no change**.

Replace `closeTabsForConnection` (it filters tabs directly) to normalize panes + rebuild
per-pane active:

```ts
  closeTabsForConnection: (connectionId) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.connectionId !== connectionId)
      if (remaining.length === s.tabs.length) return s
      const norm = normalizePanes(remaining)
      const pick = (p: PaneId): string | null => {
        const cur = s.activeTabByPane[p]
        if (cur && norm.tabs.some((t) => t.id === cur && t.pane === p)) return cur
        return norm.tabs.find((t) => t.pane === p)?.id ?? null
      }
      const activeTabByPane = { left: pick('left'), right: norm.hasRight ? pick('right') : null }
      const connFor = (id: string | null): string | null =>
        id ? (norm.tabs.find((t) => t.id === id)?.connectionId ?? null) : null
      const focusedPane: PaneId =
        norm.tabs.some((t) => t.pane === s.focusedPane) ? s.focusedPane : 'left'
      const commitModal = norm.tabs.some((t) => t.id === s.commitModal?.tabId) ? s.commitModal : null
      return withMirror({
        tabs: norm.tabs,
        focusedPane,
        activeTabByPane,
        activeConnByPane: { left: connFor(activeTabByPane.left), right: connFor(activeTabByPane.right) },
        commitModal,
      })
    }),
```

> `CloseMode` is already imported at the top of `store.ts` (`import { type CloseMode } from '../lib/tab-close'`). Keep that import.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS (new + all existing close tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "feat(store): pane-aware tab close + collapse/re-home"
```

---

## Task 6: Store — hydrate restores panes

**Files:**
- Modify: `src/renderer/src/state/store.ts`, `src/shared/domain.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Add `pane` to `SessionTab` (shared)**

In `src/shared/domain.ts`, the `SessionTab` interface: add the field and relax the `active`
comment.

```ts
export interface SessionTab {
  id: string
  connectionId: string
  title: string
  text: string
  /** Which side of a split the tab was on. Absent in legacy rows → `'left'`. */
  pane: 'left' | 'right'
  /** The focused tab in its pane. At most one per pane; readers tolerate zero/extras. */
  active: boolean
}
```

- [ ] **Step 2: Write the failing test**

Append to `store.test.ts`:

```ts
describe('split views — hydrate', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [], activeTabId: null, activeConnectionId: null, _queryCounter: 0,
      focusedPane: 'left', activeTabByPane: { left: null, right: null }, activeConnByPane: { left: null, right: null },
      lastActiveByConnection: {},
    })
  })

  it('restores per-pane tabs, each pane’s active, and focuses left', () => {
    useAppStore.getState().hydrateTabs([
      { id: 'a', connectionId: 'c1', title: 'A', text: 'a', pane: 'left', active: true },
      { id: 'b', connectionId: 'c2', title: 'B', text: 'b', pane: 'right', active: true },
    ])
    const s = useAppStore.getState()
    expect(s.tabs.find((t) => t.id === 'a')!.pane).toBe('left')
    expect(s.tabs.find((t) => t.id === 'b')!.pane).toBe('right')
    expect(s.activeTabByPane).toEqual({ left: 'a', right: 'b' })
    expect(s.activeConnByPane).toEqual({ left: 'c1', right: 'c2' })
    expect(s.focusedPane).toBe('left')
    expect(s.activeTabId).toBe('a') // mirror = focused (left)
  })

  it('treats legacy tabs (no pane) as a single left pane', () => {
    useAppStore.getState().hydrateTabs([
      { id: 'a', connectionId: 'c1', title: 'A', text: 'a', active: true } as never,
    ])
    const s = useAppStore.getState()
    expect(s.tabs[0].pane).toBe('left')
    expect(s.tabs.some((t) => t.pane === 'right')).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "split views — hydrate"`
Expected: FAIL — hydrate ignores `pane` and the per-pane maps.

- [ ] **Step 4: Rewrite `hydrateTabs`**

Replace `hydrateTabs`:

```ts
  hydrateTabs: (sessionTabs) =>
    set((s) => {
      if (s.tabs.length > 0 || sessionTabs.length === 0) return s
      const tabs: QueryTabData[] = sessionTabs.map((t) =>
        blankTab({
          connectionId: t.connectionId,
          title: t.title,
          text: t.text,
          pane: t.pane === 'right' ? 'right' : 'left', // legacy rows (undefined) → left
        })
      )
      // Keep the persisted ids stable (session-save matches on them).
      sessionTabs.forEach((t, i) => { tabs[i].id = t.id })
      const counter = tabs.reduce((max, t) => {
        const m = /^Query (\d+)$/.exec(t.title)
        return m ? Math.max(max, Number(m[1])) : max
      }, s._queryCounter)
      // Each pane's active = its flagged tab, else its first tab.
      const activeIn = (p: PaneId): string | null => {
        const inPane = tabs.filter((t) => t.pane === p)
        const flagged = inPane.find((t, i) => sessionTabs[tabs.indexOf(t)]?.active)
        return (flagged ?? inPane[0])?.id ?? null
      }
      const activeTabByPane = { left: activeIn('left'), right: activeIn('right') }
      const connFor = (id: string | null): string | null =>
        id ? (tabs.find((t) => t.id === id)?.connectionId ?? null) : null
      return withMirror({
        tabs,
        _queryCounter: counter,
        focusedPane: 'left', // focus always returns to the left pane on restore (spec)
        activeTabByPane,
        activeConnByPane: { left: connFor(activeTabByPane.left), right: connFor(activeTabByPane.right) },
        lastActiveByConnection: Object.fromEntries(
          (['left', 'right'] as PaneId[])
            .map((p) => [connFor(activeTabByPane[p]), activeTabByPane[p]])
            .filter(([c, id]) => c && id) as [string, string][]
        ),
      })
    }),
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: errors in `session.ts`/`session-save.ts` consumers are addressed in Tasks 7–8; if
`npm run typecheck:web` complains here about `SessionTab.pane` missing in `toSessionTabs`,
that's expected and fixed in Task 8. Run only the web typecheck after Task 8. For now ensure
the test file + store compile under vitest (the run in Step 5 confirms that).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/store.ts src/shared/domain.ts src/renderer/src/state/store.test.ts
git commit -m "feat(store): hydrate restores split panes (focus → left)"
```

---

## Task 7: Persistence (main) — `pane` column

**Files:**
- Modify: `src/main/persistence/db.ts`, `src/main/persistence/session.ts`
- Test: `src/main/persistence/session.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/persistence/session.test.ts`, update the `tab()` factory default and add cases:

Change the factory to default `pane: 'left'`:

```ts
function tab(over: Partial<SessionTab> & { id: string; connectionId: string }): SessionTab {
  return { title: 'Query 1', text: 'SELECT 1', pane: 'left', active: false, ...over }
}
```

Add tests inside `describe('session tabs service', ...)`:

```ts
  it('round-trips the pane column', () => {
    const c = createConnection(db, input, 1)
    const tabs = [
      tab({ id: 'a', connectionId: c.id, pane: 'left', active: true }),
      tab({ id: 'b', connectionId: c.id, pane: 'right', active: true }),
    ]
    saveSessionTabs(db, tabs)
    expect(listSessionTabs(db)).toEqual(tabs)
  })

  it('defaults legacy rows (no pane column value) to left', () => {
    const c = createConnection(db, input, 1)
    // Simulate a pre-migration row by inserting without pane (the column default applies).
    db.prepare(
      `INSERT INTO session_tabs (id, connection_id, title, text, position, active) VALUES (?,?,?,?,?,?)`
    ).run('legacy', c.id, 'L', 'x', 0, 1)
    expect(listSessionTabs(db)[0].pane).toBe('left')
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/persistence/session.test.ts`
Expected: FAIL — `pane` not selected/inserted; the round-trip mismatches.

- [ ] **Step 3: Migrate the column**

In `src/main/persistence/db.ts`, add a `pane` column to the `session_tabs` CREATE TABLE (for
fresh DBs) and an `addColumnIfMissing` call (for existing DBs).

In the CREATE TABLE for `session_tabs`, add the column after `active`:

```sql
      active        INTEGER NOT NULL DEFAULT 0,
      pane          TEXT NOT NULL DEFAULT 'left'
```

After the existing `addColumnIfMissing(...)` calls in `migrate()`, add:

```ts
  // Split views (added later): which side of a two-pane split a tab was on.
  addColumnIfMissing(db, 'session_tabs', 'pane', "TEXT NOT NULL DEFAULT 'left'")
```

- [ ] **Step 4: Read/write the column in `session.ts`**

Replace `session.ts` `Row`, `toSessionTab`, and the `saveSessionTabs` insert:

```ts
interface Row {
  id: string; connection_id: string; title: string; text: string
  position: number; active: number; pane: string
}

function toSessionTab(r: Row): SessionTab {
  return {
    id: r.id, connectionId: r.connection_id, title: r.title, text: r.text,
    pane: r.pane === 'right' ? 'right' : 'left', active: r.active === 1,
  }
}
```

In `saveSessionTabs`, update the INSERT statement + bound params:

```ts
  const insert = db.prepare(`INSERT INTO session_tabs (id, connection_id, title, text, position, active, pane)
    VALUES (@id, @connectionId, @title, @text, @position, @active, @pane)`)
  db.transaction(() => {
    db.prepare('DELETE FROM session_tabs').run()
    tabs.forEach((t, i) => {
      if ((connExists.get(t.connectionId) as { e: number }).e !== 1) return
      insert.run({ id: t.id, connectionId: t.connectionId, title: t.title, text: t.text, position: i, active: t.active ? 1 : 0, pane: t.pane })
    })
  })()
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/main/persistence/session.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (node side) + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (`npm run typecheck` covers the main/node tsconfig.)

- [ ] **Step 7: Commit**

```bash
git add src/main/persistence/db.ts src/main/persistence/session.ts src/main/persistence/session.test.ts
git commit -m "feat(persistence): session_tabs.pane column + round-trip"
```

---

## Task 8: Persistence (renderer) — save each pane's active tab

**Files:**
- Modify: `src/renderer/src/lib/session-save.ts`, `src/renderer/src/lib/use-session-persistence.ts`
- Test: `src/renderer/src/lib/session-save.test.ts`

- [ ] **Step 1: Update the failing tests**

`session-save.test.ts` currently calls `toSessionTabs(tabs, activeTabId)`. Update it to pass a
per-pane active map and assert `pane` + per-pane `active`. Replace its body's relevant cases
(keep the file's imports). Representative test:

```ts
import { describe, it, expect } from 'vitest'
import { toSessionTabs } from './session-save'
import type { QueryTabData } from '../state/store'

const base = (over: Partial<QueryTabData> & { id: string; connectionId: string; pane: 'left' | 'right' }): QueryTabData => ({
  title: 'Q', text: 't', kind: undefined, epoch: 0, runOnOpen: false, running: false,
  queryId: null, result: null, error: null, scriptRun: null, edits: {}, editError: null, ...over,
})

describe('toSessionTabs', () => {
  it('flags each pane’s active tab and emits pane', () => {
    const tabs = [
      base({ id: 'a', connectionId: 'c1', pane: 'left' }),
      base({ id: 'b', connectionId: 'c1', pane: 'right' }),
    ]
    const out = toSessionTabs(tabs, { left: 'a', right: 'b' })
    expect(out).toEqual([
      { id: 'a', connectionId: 'c1', title: 'Q', text: 't', pane: 'left', active: true },
      { id: 'b', connectionId: 'c1', title: 'Q', text: 't', pane: 'right', active: true },
    ])
  })

  it('skips diagram tabs', () => {
    const tabs = [base({ id: 'd', connectionId: 'c1', pane: 'left', kind: 'diagram' })]
    expect(toSessionTabs(tabs, { left: 'd', right: null })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/lib/session-save.test.ts`
Expected: FAIL — signature/shape mismatch.

- [ ] **Step 3: Update `toSessionTabs`**

Replace `toSessionTabs` in `session-save.ts`:

```ts
import type { SessionTab } from '@shared/domain'
import type { PaneId } from './panes'
import type { QueryTabData } from '../state/store'

/** Project the tab strip onto its persisted shape — text only, volatile state stays out.
 *  Diagram tabs are ephemeral and skipped. Each pane's active tab is flagged. */
export function toSessionTabs(
  tabs: QueryTabData[],
  activeByPane: Record<PaneId, string | null>
): SessionTab[] {
  return tabs
    .filter((t) => t.kind !== 'diagram')
    .map((t) => ({
      id: t.id,
      connectionId: t.connectionId,
      title: t.title,
      text: t.text,
      pane: t.pane,
      active: t.id === activeByPane[t.pane],
    }))
}
```

- [ ] **Step 4: Update the persistence hook**

In `src/renderer/src/lib/use-session-persistence.ts`, update the `save` closure + the change
guard:

```ts
    const save = (): void => {
      const s = useAppStore.getState()
      saver.save(toSessionTabs(s.tabs, s.activeTabByPane))
    }

    const unsubscribe = useAppStore.subscribe((s, prev) => {
      // Only tab-strip / per-pane-active changes matter here.
      if (s.tabs === prev.tabs && s.activeTabByPane === prev.activeTabByPane) return
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        save()
      }, SAVE_THROTTLE_MS)
    })
```

- [ ] **Step 5: Run all unit tests + web typecheck + lint**

Run: `npx vitest run && npm run typecheck:web && npm run lint`
Expected: PASS, no type/lint errors. (This is the first point where the renderer typechecks
end-to-end with the new `SessionTab.pane` everywhere.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/session-save.ts src/renderer/src/lib/use-session-persistence.ts src/renderer/src/lib/session-save.test.ts
git commit -m "feat(persistence): persist each pane's active tab + pane field"
```

---

## Task 9: `EditorPane` + App renders one pane (no visual change yet)

**Files:**
- Create: `src/renderer/src/components/EditorPane.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/TabBar.tsx`

Extract the "TabBar + active content" block into `EditorPane`, give `TabBar` a `pane` prop,
and have `App` render a single left `EditorPane`. The app must look and behave identically
(still one pane).

- [ ] **Step 1: Give `TabBar` a `pane` prop**

In `src/renderer/src/components/TabBar.tsx`, change the signature and the pieces that read
global active state to be pane-scoped:

```tsx
import { type PaneId } from '../lib/panes'

export default function TabBar({ pane }: { pane: PaneId }): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabByPane[pane])
  const activeConnectionId = useAppStore((s) => s.activeConnByPane[pane])
  const focusPane = useAppStore((s) => s.focusPane)
  // ...keep the rest of the selectors...
```

Scope the derived sets to this pane:

```tsx
  const paneAllTabs = tabs.filter((t) => t.pane === pane)
  const groups = groupTabs(paneAllTabs)
  const subtabs = paneAllTabs.filter((t) => t.connectionId === activeConnectionId)
```

In the group-row button `onClick`, focus this pane first:

```tsx
                onClick={() => { focusPane(pane); setActiveConnection(g.connectionId) }}
```

In the `+` button `onClick`, focus this pane first:

```tsx
          onClick={() => { focusPane(pane); activeConnectionId && openQueryTab({ connectionId: activeConnectionId }) }}
```

(Leave everything else as-is; the Split button + "Move to other side" come in Tasks 11–12.)

- [ ] **Step 2: Create `EditorPane.tsx`**

Create `src/renderer/src/components/EditorPane.tsx`:

```tsx
import { useAppStore } from '../state/store'
import { type PaneId } from '../lib/panes'
import TabBar from './TabBar'
import QueryTab from './QueryTab'
import DiagramView from './DiagramView'
import Welcome from './Welcome'

/** One editor group: its own tab strip + the pane's active tab content. Reused for both
 *  sides of a split. Clicking anywhere inside focuses the pane (so new tabs and the sidebar
 *  target it). The focus accent only shows while the view is actually split. */
export default function EditorPane({ paneId }: { paneId: PaneId }): JSX.Element {
  const focusedPane = useAppStore((s) => s.focusedPane)
  const activeId = useAppStore((s) => s.activeTabByPane[paneId])
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === activeId) ?? null)
  const splitView = useAppStore((s) => s.tabs.some((t) => t.pane === 'right'))
  const focusPane = useAppStore((s) => s.focusPane)

  return (
    <div
      className={`editor-pane${splitView && paneId === focusedPane ? ' focused' : ''}`}
      onMouseDownCapture={() => focusPane(paneId)}
    >
      <TabBar pane={paneId} />
      {tab ? (
        tab.kind === 'diagram' ? (
          <DiagramView key={tab.id} connectionId={tab.connectionId} />
        ) : (
          <QueryTab key={tab.id} tab={tab} />
        )
      ) : (
        <Welcome />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render `EditorPane` from `App.tsx`**

In `src/renderer/src/App.tsx`, replace the `<main className="main">…</main>` block. Remove the
now-unused `TabBar`/`QueryTab`/`DiagramView`/`activeTab` wiring from `AppShell` and use:

```tsx
import EditorPane from './components/EditorPane'
// remove: import TabBar, QueryTab, DiagramView (now used inside EditorPane)
// remove the `const activeTab = tabs.find(...)` line and the activeTabId selector if unused
```

```tsx
        <main className="main">
          {tabs.length === 0 ? <Welcome /> : <EditorPane paneId="left" />}
        </main>
```

> Keep the `tabs` selector if still referenced; drop `activeTabId`/`activeTab` if they become
> unused (lint will flag them). `Welcome` is still imported for the no-tabs case.

- [ ] **Step 4: Verify single-pane parity**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

Run the dev app and confirm nothing changed visually: tabs, switching, new tab, close,
sidebar selection, diagram tab, query run all behave exactly as before.

Run: `npx vitest run`
Expected: PASS (no test regressions).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/EditorPane.tsx src/renderer/src/App.tsx src/renderer/src/components/TabBar.tsx
git commit -m "refactor(ui): extract EditorPane; TabBar takes a pane prop (single-pane parity)"
```

---

## Task 10: Two-pane layout + `PaneDivider` + CSS

**Files:**
- Create: `src/renderer/src/components/PaneDivider.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1: Create `PaneDivider.tsx`**

Create `src/renderer/src/components/PaneDivider.tsx` (mirrors QueryTab's divider, horizontal):

```tsx
import { useRef, useState } from 'react'
import {
  clampPaneFraction,
  dragPaneFraction,
  loadPaneFraction,
  savePaneFraction,
  DEFAULT_PANE_FRACTION,
  MIN_PANE_FRACTION,
  MAX_PANE_FRACTION,
} from '../lib/pane-split'

/** Vertical drag-to-resize between the two editor panes. The left pane gets `fraction` of the
 *  container width as flex-basis; the parent `.panes` is the positioning context. Direct DOM
 *  writes during the drag (no React re-render per pointermove — the grids under both panes
 *  would re-render); React state + localStorage commit on pointerup. */
export default function PaneDivider({ leftPaneRef }: { leftPaneRef: React.RefObject<HTMLDivElement> }): JSX.Element {
  const [fraction, setFraction] = useState(() => loadPaneFraction())
  const dragRef = useRef(fraction)

  function commit(f: number): void {
    dragRef.current = f
    setFraction(f)
    savePaneFraction(f)
    const pane = leftPaneRef.current
    if (pane) pane.style.flexBasis = `${f * 100}%`
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const pane = leftPaneRef.current
    const container = pane?.parentElement
    if (!pane || !container) return
    const rect = container.getBoundingClientRect()
    const f = dragPaneFraction(e.clientX, rect.left, rect.width)
    dragRef.current = f
    pane.style.flexBasis = `${f * 100}%`
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    commit(dragRef.current)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : null
    if (step === null) return
    e.preventDefault()
    commit(clampPaneFraction(dragRef.current + step))
  }

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the two panes"
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round(MAX_PANE_FRACTION * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => commit(DEFAULT_PANE_FRACTION)}
      onKeyDown={onKeyDown}
    />
  )
}
```

> The left pane needs a ref so the divider can write its flex-basis. `EditorPane` doesn't
> forward a ref, so wrap the left pane in a `<div className="pane-slot">` carrying the ref and
> the initial flex-basis (next step), rather than threading a ref through `EditorPane`.

- [ ] **Step 2: Render the split in `App.tsx`**

Replace the `<main>` block from Task 9 with the two-pane version. Add a ref + `loadPaneFraction`
for the left slot's initial width:

```tsx
import { useRef } from 'react'
import EditorPane from './components/EditorPane'
import PaneDivider from './components/PaneDivider'
import { loadPaneFraction } from './lib/pane-split'
```

Inside `AppShell`, near the other hooks:

```tsx
  const splitView = useAppStore((s) => s.tabs.some((t) => t.pane === 'right'))
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const initialLeftFraction = loadPaneFraction()
```

The `<main>`:

```tsx
        <main className="main">
          {tabs.length === 0 ? (
            <Welcome />
          ) : splitView ? (
            <div className="panes">
              <div className="pane-slot" ref={leftPaneRef} style={{ flexBasis: `${initialLeftFraction * 100}%` }}>
                <EditorPane paneId="left" />
              </div>
              <PaneDivider leftPaneRef={leftPaneRef} />
              <div className="pane-slot pane-slot-right">
                <EditorPane paneId="right" />
              </div>
            </div>
          ) : (
            <EditorPane paneId="left" />
          )}
        </main>
```

- [ ] **Step 3: Add the CSS**

In `src/renderer/src/styles.css`, after the `.app-body > .main { … }` rule, add:

```css
/* ── Split panes ── */
.panes {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;
}

.pane-slot {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 0 0 50%; /* left slot; React overwrites flex-basis from the saved fraction */
}

.pane-slot-right {
  flex: 1 1 0; /* right slot takes the remainder */
}

.editor-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.editor-pane.focused .tabbar-wrap {
  box-shadow: inset 0 2px 0 var(--accent);
}

.pane-divider {
  flex: 0 0 6px;
  cursor: col-resize;
  touch-action: none;
  background: linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat;
}

.pane-divider:hover,
.pane-divider:focus-visible {
  background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
  outline: none;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

> Visual verification is deferred to Task 11 (nothing triggers a split yet). If you want to
> test now, temporarily set a tab's `pane` to `'right'` via devtools and confirm the two-pane
> layout + divider drag works, then revert.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/PaneDivider.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ui): two-pane split layout + draggable PaneDivider"
```

---

## Task 11: Split button (makes it user-triggerable)

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1: Add the Split button to `TabBar`**

In `src/renderer/src/components/TabBar.tsx`, add the selector + button. Selector near the
others:

```tsx
  const splitActiveTab = useAppStore((s) => s.splitActiveTab)
```

Render a Split button immediately after the `+` (`tab-add`) button, disabled when the pane has
no active tab:

```tsx
        <button
          className="tab-split btn ghost"
          aria-label="Split — open this tab on the other side"
          title="Open this tab on the other side"
          disabled={!activeTabId}
          onClick={() => { focusPane(pane); splitActiveTab() }}
        >
          ⊟
        </button>
```

- [ ] **Step 2: Style the button**

In `styles.css`, after the `.tab-add { … }` rule, add:

```css
.tab-split {
  font-size: 13px;
  line-height: 1;
}
```

- [ ] **Step 3: Verify the full feature manually**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

Run the dev app and verify:
- With ≥2 tabs in one connection, click Split → the active tab moves to a right pane; both
  panes show their own strip; the divider drags; the focused (right) pane shows the accent.
- With 1 tab, click Split → a fresh query tab opens on the right; original stays left.
- Open a different connection's table in the right pane (focus right, pick the connection in
  the sidebar, double-click a table) → right shows conn B, left still shows conn A.
- Close the last tab on a side → collapses back to a single pane.
- Re-open an already-open table (double-click) → focuses its existing tab in whichever pane.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): Split button on the tab bar"
```

---

## Task 12: "Move to other side" context-menu item

**Files:**
- Modify: `src/renderer/src/components/TabContextMenu.tsx`, `src/renderer/src/components/TabBar.tsx`

- [ ] **Step 1: Add the menu item + action type**

In `src/renderer/src/components/TabContextMenu.tsx`, widen the action type and add the item.

```tsx
export type TabCloseAction = 'close' | 'others' | 'right' | 'left' | 'all' | 'move-pane'
```

Add the item at the top of the menu (before `Close`), with a separator after it:

```tsx
        {item('move-pane', 'Move to other side')}
        <div className="tab-menu-sep" aria-hidden="true" />
        {item('close', 'Close')}
```

- [ ] **Step 2: Style the separator**

In `styles.css`, near the `.tab-menu` rules, add:

```css
.tab-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}
```

- [ ] **Step 3: Wire the action in `TabBar`**

In `TabBar.tsx`, add the selector:

```tsx
  const moveTabToOtherPane = useAppStore((s) => s.moveTabToOtherPane)
```

In `runMenu`, handle the new action (it acts on the menu's target tab id):

```tsx
  const runMenu = (action: TabCloseAction): void => {
    if (!menu) return
    const id = menu.tabId
    if (action === 'move-pane') moveTabToOtherPane(id)
    else if (action === 'close') closeTab(id)
    else if (action === 'others') closeOtherTabs(id)
    else if (action === 'right') closeTabsToRight(id)
    else if (action === 'left') closeTabsToLeft(id)
    else closeAllTabs(id)
  }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

Dev app: right-click a tab → "Move to other side" moves it across and focuses the destination;
moving the only tab on a side collapses/recreates the split correctly.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabContextMenu.tsx src/renderer/src/components/TabBar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): 'Move to other side' tab context-menu action"
```

---

## Task 13: Full gates + manual smoke + session-restore check

**Files:** none (verification only)

- [ ] **Step 1: Run every gate**

Run: `npm run typecheck && npm run typecheck:web && npm run lint && npx vitest run`
Expected: all green. Note the new unit-test count (was 606 before this feature).

- [ ] **Step 2: Manual smoke (dev app)**

Verify end-to-end, then quit and relaunch to confirm the split restores:
- Split same-connection (105 | 106) and cross-connection (conn A | conn B).
- Divider drag persists across a tab switch and a relaunch.
- Quit while split → relaunch → both panes restored, focus on the left pane, divider ratio kept.
- Legacy session (if one exists) loads as a single left pane (no crash).
- `⌘W` closes the focused pane's active tab; closing a side's last tab collapses.

- [ ] **Step 3: Update the memory roadmap**

Append a short note to the db-client roadmap memory recording the split-views feature (per the
repo's memory conventions) — two side-by-side editor groups, `pane` field + per-pane store
state with focused-pane mirrors, `lib/panes.ts`/`lib/pane-split.ts`, `EditorPane`/`PaneDivider`,
`session_tabs.pane`. Update the unit-test count.

- [ ] **Step 4: Final commit (if memory/docs changed)**

```bash
git add -A && git commit -m "docs: record split-views feature + test count"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Two side-by-side groups, connection-agnostic → Tasks 3–5, 9–11. ✓
- Vertical draggable divider → Tasks 2, 10. ✓
- Split button + "Move to other side"; collapse on empty → Tasks 4, 11, 12; collapse in Task 5. ✓
- Focused pane drives sidebar/new-tab (mirrors) → Task 3 (`withMirror`), Task 9 (focus on click). ✓
- `lib/panes.ts` pure helpers (`otherPane`/`paneTabs`/`nextActiveInPane`/`normalizePanes`/`applyPaneClose`) → Task 1. ✓
- `pane-split.ts` divider math → Task 2. ✓
- Persistence (`pane` column, one-active-per-pane, focus→left on restore) → Tasks 6, 7, 8. ✓
- CSS (`.panes`/`.editor-pane`/`.focused`/`.pane-divider`/`.tab-split`) → Tasks 10, 11, 12. ✓
- Out-of-scope (no DnD/N-panes/horizontal) honored — no task adds them. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**3. Type consistency:** `PaneId` declared once in `lib/panes.ts`, imported elsewhere. `activeTabByPane`/`activeConnByPane`/`focusedPane` names consistent across store, persistence, components. `toSessionTabs(tabs, activeByPane)` signature matches its caller in `use-session-persistence.ts` and its tests. `applyPaneClose` return shape (`{tabs, activeByPane, focusedPane}`) matches `closeTabsResult`'s usage. `TabCloseAction` extended consistently in `TabContextMenu` + `TabBar`. ✓
