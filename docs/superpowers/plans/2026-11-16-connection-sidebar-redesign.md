# Connection Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise Ganesha's shell around connections: a two-zone sidebar (connections above, per-connection explorer below), a per-pane environment bar that carries the run buttons, one right dock, a restyled dashboard, and a roomier look with a compact fallback.

**Architecture:** The tab/connection model in the store is unchanged (`activeConnectionId` mirrors the focused pane; groups are derived by `lib/tab-groups.ts`). New behaviour goes into small pure libs with unit tests (the project has no component-render tests), and the components are thin readers of the store. Density is a setting applied as `data-density` on `<html>`, driving CSS tokens plus two JS metrics.

**Tech Stack:** Electron 31, React 18, TypeScript, zustand, TanStack Query, Vitest (node env), better-sqlite3, one stylesheet (`src/renderer/src/styles.css`).

**Spec:** `docs/superpowers/specs/2026-11-16-connection-sidebar-redesign-design.md` — read it before any task; this plan argues from it. Mocks: https://claude.ai/artifact/VU6dvnm842UvDx4ZK3FagM (row "B mejorada").

## Global Constraints

- Node 20 only (Node 26 cannot build `better-sqlite3`): prefix commands with `mise exec node@20 --` if the shell's default Node is newer.
- Gates after every task: `npm run typecheck`, `npx eslint <changed files>`, `npm test`. All must pass before the commit step.
- No hard-coded colours in new CSS: use the theme tokens (`--bg`, `--bg-2`, `--bg-3`, `--border`, `--text`, `--text-2`, `--accent`, …). Connection colours come from `connection.color` at runtime.
- Environment cues always carry text; text on a tinted surface stays `var(--text)` (the connection colour is used only for the tint and the dot).
- Shortcuts ⌘K, ⌘B, ⌘↵, ⌘⇧↵, ⌘S and tab drag-to-reorder / drag-to-split must behave exactly as before.
- Restyle only: top bar, sidebar (incl. object-tree / saved / history rows), tab strip, environment bar, results toolbar and grid, right-dock chrome, status bar, dashboard. Do **not** restyle modals, command palette, Telescope, table-info, diagram, row inspector, assistant thread, SSM tunnel list.
- New per-machine UI preferences follow `lib/side-panel.ts`: `localStorage`, injectable storage, garbage heals to the default.
- Glyph icons (✎ ↻ ☆ ⋯ ＋ ✕ 🔒 🔭 ▶) are replaced with `Icon` SVGs **only** in components this plan touches.
- Do not split `styles.css` or extract shared Modal/Menu components.
- Commit after each task on a feature branch (`feat/connection-sidebar`); never commit to `main`.

## Review Focus

1. **Connection names with no letters or digits** (e.g. `"—"`, `"🚀"`, `""`): the collapsed badge must still show something and never throw → `connectionInitials` returns `"?"`. (Task 2)
2. **Environment text that is too long, padded, or not a string** — typed in the modal or arriving in an imported file: it is trimmed, cut to 12 characters, and a non-string becomes `''`; it never breaks the layout or the import. (Task 1)
3. **Unknown density** in the settings table or the first-paint hint (older build, hand-edited): falls back to `comfortable`; the app never renders with an unstyled `data-density`. (Task 3)
4. **Dashboard filter that matches nothing, or contains regex characters** (`.*`, `(`, `[`): treated as plain text; an all-hidden result shows "No connections match", not a blank page. (Task 10)
5. **Close others / Close all under "All tabs" in a split view**: only the clicked tab's pane is affected; the other pane's tabs survive. (Task 5)

---

### Task 1: Environment label — storage, IPC types, export/import

**Files:**
- Create: `src/shared/environment.ts`, `src/shared/environment.test.ts`
- Modify: `src/shared/domain.ts` (`ConnectionInput`), `src/main/persistence/db.ts` (`migrate`), `src/main/persistence/connections.ts`, `src/main/persistence/connection-transfer.ts` (`parseTransferFile`)
- Test: `src/main/persistence/connections.test.ts`, `src/main/persistence/connection-transfer.test.ts`, `src/main/persistence/db.test.ts`

**Interfaces:**
- Produces: `ENVIRONMENT_MAX_LENGTH = 12`; `ENVIRONMENT_SUGGESTIONS = ['PROD', 'STG', 'DEV', 'LOCAL'] as const`; `cleanEnvironment(raw: unknown): string`; `ConnectionInput.environment: string` (therefore also on `ConnectionConfig`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/environment.test.ts
expect(cleanEnvironment('  PROD  ')).toBe('PROD')
expect(cleanEnvironment('a-very-long-environment')).toBe('a-very-long-')   // 12 chars
expect(cleanEnvironment('')).toBe('')
expect(cleanEnvironment(undefined)).toBe('')
expect(cleanEnvironment(123)).toBe('')
expect(cleanEnvironment('stg')).toBe('stg')                               // stored as typed

// connections.test.ts
const c = createConnection(db, { ...input, environment: '  PROD  ' }, 1)
expect(c.environment).toBe('PROD')
expect(getConnection(db, c.id)!.environment).toBe('PROD')
expect(updateConnection(db, c.id, { environment: 'a-very-long-environment' }, 2).environment).toBe('a-very-long-')
expect(createConnection(db, input, 3).environment).toBe('')               // fixture has environment: ''

// db.test.ts — a connections table created WITHOUT the column gains it on migrate()
// (build the old table by hand, insert one row, run migrate, expect row.environment === '')

// connection-transfer.test.ts
// round trip: source connection with environment 'PROD' → imported connection has 'PROD'
// a file whose connection has no `environment` key imports as ''
// a file whose connection has `environment: 123` imports as ''
// a file whose connection has a 40-char environment imports cut to 12
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/shared/environment.test.ts src/main/persistence`
Expected: FAIL (`cleanEnvironment` not found; `environment` undefined).

- [ ] **Step 3: Implement**

- `cleanEnvironment`: non-string → `''`; else `trim()` then `slice(0, ENVIRONMENT_MAX_LENGTH)`.
- `migrate`: `addColumnIfMissing(db, 'connections', 'environment', "TEXT NOT NULL DEFAULT ''")`, and add the column to the `CREATE TABLE`.
- `connections.ts`: add `environment` to `Row`, `toConfig`, the INSERT and the UPDATE; both writes pass the value through `cleanEnvironment`.
- `parseTransferFile`: `environment: cleanEnvironment(c.environment)`. `buildExport` already spreads the whole config, so the field is exported with no change; the file `version` stays `1`.
- Add `environment: ''` to every `ConnectionInput` literal the typecheck flags (test fixtures, `ConnectionModal`'s empty form).

- [ ] **Step 4: Run the gates** — tests PASS, typecheck and lint clean.

- [ ] **Step 5: Commit** — `feat(connections): optional environment label (storage, export/import)`

---

### Task 2: Connection display helpers, environment tag, modal field

**Files:**
- Create: `src/renderer/src/lib/connection-display.ts`, `src/renderer/src/lib/connection-display.test.ts`, `src/renderer/src/components/EnvTag.tsx`
- Modify: `src/renderer/src/components/ConnectionModal.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `cleanEnvironment`, `ENVIRONMENT_MAX_LENGTH`, `ENVIRONMENT_SUGGESTIONS` (Task 1).
- Produces:
  - `connectionInitials(name: string): string`
  - `connectionModeText(c: { readOnly: boolean; requireCommit: boolean }): string`
  - `connectionHostText(c: { type: string; host: string; port: number }): string`
  - `<EnvTag connection={{ environment, color }} />` — renders `null` when `environment` is empty; otherwise a `<span className="env-tag">` whose background is `color-mix(in srgb, <color> 22%, transparent)` and whose text is `var(--text)`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(connectionInitials('orders-prod')).toBe('OP')
expect(connectionInitials('analytics mongo db')).toBe('AM')      // first two words only
expect(connectionInitials('local')).toBe('LO')                   // one word → first two letters
expect(connectionInitials('x')).toBe('X')
expect(connectionInitials('  blog_db  ')).toBe('BD')
expect(connectionInitials('—')).toBe('?')
expect(connectionInitials('🚀')).toBe('?')
expect(connectionInitials('')).toBe('?')
expect(connectionInitials('3d-store')).toBe('3S')

expect(connectionModeText({ readOnly: true, requireCommit: true })).toBe('Read-only — writes are blocked')
expect(connectionModeText({ readOnly: false, requireCommit: true })).toBe('Edits stage until you commit')
expect(connectionModeText({ readOnly: false, requireCommit: false })).toBe('')

expect(connectionHostText({ type: 'postgres', host: 'db.internal', port: 5432 })).toBe('postgres · db.internal:5432')
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/connection-display.test.ts` — FAIL.

- [ ] **Step 3: Implement the lib.** Initials: split the name on `/[^\p{L}\p{N}]+/u`, drop empty parts; two or more parts → first character of the first two; one part → its first two characters; none → `'?'`; uppercase.

- [ ] **Step 4: Add `EnvTag` and the modal field.** In `ConnectionModal`, next to the colour swatches: a text `<input>` labelled "Environment", `maxLength={ENVIRONMENT_MAX_LENGTH}`, `list` pointing at a `<datalist>` built from `ENVIRONMENT_SUGGESTIONS`, hint "Shown next to the connection's name. Optional." Bound to `form.environment`; loaded from the existing connection on edit.

- [ ] **Step 5: Gates, then commit** — `feat(connections): environment field in the modal + display helpers`

---

### Task 3: Density setting and tokens

**Files:**
- Create: `src/renderer/src/lib/density.ts`, `src/renderer/src/lib/density.test.ts`
- Modify: `src/shared/domain.ts` (`AppSettings`, `DEFAULT_SETTINGS`), `src/main/persistence/settings.ts` (`getSettings`), `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/SettingsModal.tsx`, `src/renderer/src/components/MonacoEditor.tsx`, `src/renderer/src/components/ResultsGrid.tsx`, `src/renderer/src/styles.css`
- Test: `src/main/persistence/settings.test.ts`

**Interfaces:**
- Produces:
  - `type Density = 'comfortable' | 'compact'`; `AppSettings.density: Density`; `DEFAULT_SETTINGS.density = 'comfortable'`
  - `parseDensity(raw: unknown): Density`
  - `DENSITY_METRICS: Record<Density, { editorFontSize: number; gridRowHeight: number }>` = `{ comfortable: { editorFontSize: 14, gridRowHeight: 40 }, compact: { editorFontSize: 13, gridRowHeight: 26 } }`
  - `densityHint(storage?): Density`, `applyDensity(d: Density, storage?): void` (sets `document.documentElement.dataset.density` and the `density-hint` key)
  - `useDensity(): Density` in `lib/hooks.ts` (from `useSettings`, default comfortable)
  - CSS tokens on `:root`: `--fs-base`, `--fs-sm`, `--fs-xs`, `--control-h`, `--row-h`, `--pad-x`, `--gap`, `--radius-md`, `--radius-lg`

Token values:

| Token | comfortable (`:root`) | compact (`:root[data-density='compact']`) |
|---|---|---|
| `--fs-base` / `--fs-sm` / `--fs-xs` | 14px / 13px / 12px | 13px / 12px / 11px |
| `--control-h` | 36px | 28px |
| `--row-h` | 36px | 28px |
| `--pad-x` | 24px | 12px |
| `--gap` | 8px | 6px |
| `--radius-md` / `--radius-lg` | 9px / 14px | 7px / 9px |

The existing `--radius: 7px` is left alone (out-of-scope regions use it).

- [ ] **Step 1: Write the failing tests**

```ts
// density.test.ts
expect(parseDensity('compact')).toBe('compact')
expect(parseDensity('comfortable')).toBe('comfortable')
expect(parseDensity('cozy')).toBe('comfortable')
expect(parseDensity(null)).toBe('comfortable')
expect(densityHint({ getItem: () => 'compact' })).toBe('compact')
expect(densityHint({ getItem: () => 'garbage' })).toBe('comfortable')
expect(DENSITY_METRICS.compact).toEqual({ editorFontSize: 13, gridRowHeight: 26 })

// settings.test.ts
expect(getSettings(db).density).toBe('comfortable')            // unset
setSetting(db, 'density', 'compact');  expect(getSettings(db).density).toBe('compact')
setSetting(db, 'density', 'huge');     expect(getSettings(db).density).toBe('comfortable')
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/density.test.ts src/main/persistence/settings.test.ts` — FAIL.

- [ ] **Step 3: Implement** the types, `getSettings` validation, the lib and the hook. `main.tsx` sets `dataset.density = densityHint()` beside the theme hint; `App.tsx` calls `applyDensity(settings.density)` in the effect that applies the theme.

- [ ] **Step 4: Wire the two JS metrics.** `MonacoEditor`: `fontSize` from `DENSITY_METRICS[density].editorFontSize`, and `editor.updateOptions({ fontSize })` when it changes. `ResultsGrid`: `estimateSize` returns `gridRowHeight`, and the virtualizer re-measures when density changes.

- [ ] **Step 5: Settings modal.** A two-option radio group "Density": **Comfortable** / **Compact**, calling `setSetting.mutate({ key: 'density', value })`.

- [ ] **Step 6: Add the token block to `styles.css`** exactly as in the table. Nothing consumes the tokens yet.

- [ ] **Step 7: Gates, then commit** — `feat(settings): comfortable/compact density setting + tokens`

---

### Task 4: Shell preferences, dock state, tab scope — pure logic

**Files:**
- Create: `src/renderer/src/lib/shell-prefs.ts`, `src/renderer/src/lib/shell-prefs.test.ts`, `src/renderer/src/lib/dock.ts`, `src/renderer/src/lib/dock.test.ts`
- Modify: `src/renderer/src/lib/tab-groups.ts`, `src/renderer/src/lib/tab-groups.test.ts`, `src/renderer/src/lib/connection-groups.ts`, `src/renderer/src/lib/connection-groups.test.ts`

**Interfaces:**
- Produces:
  - `type TabScope = 'all' | 'connection'`; `loadTabScope(storage?): TabScope` (default `'all'`), `saveTabScope(s, storage?)` — key `tab-scope`
  - `loadCollapsedGroups(storage?): string[]`, `saveCollapsedGroups(ids: string[], storage?)` — key `sidebar-collapsed-groups`, JSON array
  - `type DockTab = 'assistant' | 'tunnels'`; `toggleDock(current: DockTab | null, target: DockTab): DockTab | null`
  - `visibleTabs<T extends { connectionId: string }>(paneTabs: T[], scope: TabScope, activeConnectionId: string | null): T[]`
  - `showScopeSwitch(paneTabs: { connectionId: string }[]): boolean`
  - `type SidebarRow = { kind: 'group'; group: ConnectionGroup; depth: 0 | 1; collapsed: boolean; count: number } | { kind: 'connection'; connection: ConnectionConfig; depth: 0 | 1 | 2 }`
  - `sidebarRows(sections: GroupSection[], collapsed: ReadonlySet<string>): SidebarRow[]`

- [ ] **Step 1: Write the failing tests**

```ts
// dock.test.ts
expect(toggleDock(null, 'assistant')).toBe('assistant')
expect(toggleDock('assistant', 'assistant')).toBe(null)
expect(toggleDock('assistant', 'tunnels')).toBe('tunnels')      // switches, does not close

// shell-prefs.test.ts
expect(loadTabScope({ getItem: () => null })).toBe('all')
expect(loadTabScope({ getItem: () => 'connection' })).toBe('connection')
expect(loadTabScope({ getItem: () => 'x' })).toBe('all')
expect(loadCollapsedGroups({ getItem: () => '["a","b"]' })).toEqual(['a', 'b'])
expect(loadCollapsedGroups({ getItem: () => 'not json' })).toEqual([])
expect(loadCollapsedGroups({ getItem: () => '{"a":1}' })).toEqual([])
expect(loadCollapsedGroups({ getItem: () => '["a",3]' })).toEqual(['a'])

// tab-groups.test.ts   (tabs: a1,a2 on conn A; b1 on conn B)
expect(visibleTabs(tabs, 'all', 'A').map(t => t.id)).toEqual(['a1', 'a2', 'b1'])
expect(visibleTabs(tabs, 'connection', 'A').map(t => t.id)).toEqual(['a1', 'a2'])
expect(visibleTabs(tabs, 'connection', null)).toEqual([])
expect(showScopeSwitch(tabs)).toBe(true)
expect(showScopeSwitch(tabs.slice(0, 2))).toBe(false)
expect(showScopeSwitch([])).toBe(false)

// connection-groups.test.ts   (root "Work" with conn p, subgroup "Staging" with conn s; ungrouped conn l)
// nothing collapsed → [group Work d0 count 2, conn p d1, group Staging d1 count 1, conn s d2, conn l d0]
// 'Work' collapsed  → [group Work d0 collapsed count 2, conn l d0]
// 'Staging' collapsed → [group Work, conn p, group Staging collapsed count 1, conn l]
// no groups at all → just the connections at depth 0 (the ungrouped section has no header row)
// an empty group still yields its header row with count 0
```

`count` on a group row = its own connections plus its subgroups' connections.

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib` — FAIL on the new cases.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gates, then commit** — `feat(shell): pure logic for dock, tab scope and sidebar rows`

---

### Task 5: Store — dock, tab scope, scope-aware close, transfer modal

**Files:**
- Modify: `src/renderer/src/state/store.ts`, `src/renderer/src/lib/panes.ts`, `src/renderer/src/lib/panes.test.ts`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/AssistantPanel.tsx`, `src/renderer/src/components/SsmPanel.tsx`, `src/renderer/src/components/Welcome.tsx`, `src/renderer/src/App.tsx`
- Create: `src/renderer/src/lib/transfer-actions.ts`

**Interfaces:**
- Consumes: `toggleDock`, `DockTab`, `TabScope`, `loadTabScope`, `saveTabScope` (Task 4).
- Produces (store):
  - `dock: DockTab | null` — **replaces** `assistantOpen` and `ssmOpen`
  - `toggleAssistant(): void`, `toggleSsm(): void` (names kept; implemented with `toggleDock`), `closeDock(): void`
  - `tabScope: TabScope` (initialised from `loadTabScope()`), `setTabScope(s: TabScope): void` (persists)
  - `transferModal: TransferModalState | null`, `setTransferModal(s: TransferModalState | null): void`
- Produces (libs):
  - `applyPaneClose(tabs, activeByPane, focusedPane, mode, targetId, scope: TabScope = 'connection')` — with `'all'`, the closing scope is every tab in the target's pane.
  - `startImport(): Promise<string | null>` in `transfer-actions.ts` — calls `window.api.connections.importPick()`; on a picked file sets `transferModal` to `{ mode: 'import', preview }` and resolves `null`; on cancel resolves `null`; on failure resolves the error message.

- [ ] **Step 1: Write the failing tests** (`panes.test.ts`)

```ts
// left pane: a1,a2 (conn A), b1 (conn B); right pane: a3 (conn A), c1 (conn C)
// 'others' on a1, scope 'all'        → left keeps a1 only; right still a3,c1
// 'all' on a1, scope 'all'           → left empty; right a3,c1 survive and focus moves right→ collapses per existing rules
// 'others' on a1, scope 'connection' → left keeps a1,b1 (today's behaviour, unchanged default)
// 'right' on a1, scope 'all'         → left keeps a1; b1 and a2 closed
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/panes.test.ts` — FAIL.
- [ ] **Step 3: Implement** the `scope` parameter; the store's close actions pass `s.tabScope`.
- [ ] **Step 4: Store fields.** Replace `assistantOpen` / `ssmOpen` with `dock`; update the four readers (`TopBar`, `AssistantPanel`, `SsmPanel`, store) to `dock === 'assistant'` / `dock === 'tunnels'`. (For now opening one closes the other; the unified dock UI comes in Task 9.)
- [ ] **Step 5: Lift the transfer dialog.** `Welcome` drops its local `transfer` state and `startImport`, uses the store field and `transfer-actions.startImport` (showing a returned message in its existing error line); `App` renders `<ConnectionTransferModal>` when `transferModal` is set.
- [ ] **Step 6: Gates.** Then launch the app (`npm run dev`) and confirm: assistant and tunnels buttons still open their panels; dashboard Import/Export still open their dialogs.
- [ ] **Step 7: Commit** — `refactor(store): single dock state, tab scope, shared transfer dialog`

---

### Task 6: Sidebar (replaces Rail + SidePanel)

**Files:**
- Create: `src/renderer/src/components/Sidebar.tsx`, `SidebarConnections.tsx`, `SidebarExplorer.tsx`, `SidebarBadges.tsx` (same folder)
- Delete: `src/renderer/src/components/Rail.tsx`, `src/renderer/src/components/SidePanel.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/lib/hooks.ts`, `src/renderer/src/components/ConnectionModal.tsx`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `sidebarRows`, `loadCollapsedGroups` / `saveCollapsedGroups`, `connectionInitials`, `EnvTag`, `startImport`, store `setTransferModal`, `groupTabs`, existing `lib/side-panel.ts` (width / open / section — unchanged keys).
- Produces:
  - `<Sidebar />` — no props; `App` renders it where `<Rail /><SidePanel />` were.
  - `useConnectionActions(): { remove(c: { id: string; name: string }): void; duplicate(id: string): void; removing: boolean; duplicating: boolean }` in `lib/hooks.ts` — `remove` confirms with `Delete connection "<name>"? This cannot be undone.`, deletes, and clears the active connection only if the deleted one is still active; `duplicate` opens the copy in the edit modal. `ConnectionModal` switches to it (its `closeModal()` after delete stays in the modal).
  - Icons added to `icons.tsx`: `more` (three dots), `sidebar` (panel toggle), `chevron-down`, `chevron-right`, `import`, `export`, `lock`, `refresh`, `star`, `play`, `close`, `search` (skip any that already exist).

Behaviour (all from spec §2 and §6):

- `Sidebar` owns the `<aside>`, the resize handle and width exactly as `SidePanel` did. Expanded when `sideOpen`; otherwise it renders `SidebarBadges`.
- `hideConnections = tabs.length === 0 || dashboardOpen`. When true, the expanded sidebar renders only `SidebarExplorer`.
- `SidebarConnections`: header (label "Connections", Home → `toggleDashboard`, New connection → `openModal({ mode: 'create' })`, `⋯` menu with **New group**, **Import…**, **Export…**, Collapse → `toggleSide`). Rows from `sidebarRows`. Group row click toggles collapse (persisted). Connection row: click → `setActiveConnection(id)`; double-click → also `openQueryTab({ connectionId: id })`; context menu → Edit / Duplicate / Delete. Zone has `max-height: 45%` and its own scroll. "New group" turns the menu into an inline name input, as the dashboard does.
- `SidebarExplorer`: header with the active connection's dot and name, diagram button (`openDiagramTab`), Telescope button (only when the connection's objects include `telescope_entries` — the rule `TopBar` uses today); segmented control Schema / Saved / History bound to `sideSection` / `selectSideSection`; then `ObjectTree` / `SavedSection` / `HistorySection`, or the "No connection selected." hint.
- `SidebarBadges`: Expand, Home, then one button per connection id from `groupTabs(tabs)` that still exists in `useConnections()` — initials over a colour bar, `aria-label` and tooltip = connection name, click → `setActiveConnection`; then `+` → `toggleSide`.
- `selectSideSection` today collapses the panel when the active section is clicked again; with a segmented control that must **not** collapse. Change the action so it only selects (the Collapse button and ⌘B are the only collapse paths).

- [ ] **Step 1: Add `useConnectionActions` and move `ConnectionModal` onto it.** Run the gates.
- [ ] **Step 2: Build the four components and the icons; swap them into `App`; delete `Rail` and `SidePanel`.**
- [ ] **Step 3: Styles** for the sidebar using the Task 3 tokens (`--row-h` rows, `--fs-base` text, `--radius-md`), zones separated by spacing with no rule between them. Remove the now-dead `.rail*` and `.side-head` rules.
- [ ] **Step 4: Gates.**
- [ ] **Step 5: Verify in the running app:** click vs double-click on a connection; group collapse survives a restart; context-menu Delete asks for confirmation; ⌘B collapses to badges and back; with zero tabs the Connections zone is hidden and selecting a dashboard card fills the explorer; resize handle and its keyboard arrows still work.
- [ ] **Step 6: Commit** — `feat(shell): two-zone connection sidebar replaces the rail`

---

### Task 7: Environment bar, pane empty state, slim top bar

**Files:**
- Create: `src/renderer/src/components/EnvBar.tsx`, `src/renderer/src/components/PaneEmpty.tsx`
- Delete: `src/renderer/src/components/ConnectionMenu.tsx` (only `TopBar` uses it — confirm with a search first)
- Modify: `src/renderer/src/components/EditorPane.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `EnvTag`, `connectionModeText`, `connectionHostText`, `getTabActions`, existing store actions (`openSaveQueryModal`, `requestScriptStop`, `setCancelError`) and `useCancelQuery`.
- Produces:
  - `<EnvBar paneId={PaneId} />` — rendered by `EditorPane` between `<TabBar>` and the body when the pane has an active tab.
  - `<PaneEmpty connectionId={string | null} />` — rendered by `EditorPane` when the pane has no active tab (replaces `<Welcome />` there).

Behaviour (spec §4 and §2):

- `EnvBar` resolves the pane's active tab and its connection. Left: `EnvTag`, `connectionModeText` (omitted when empty), `connectionHostText` in muted text. Right, **only for query tabs**: Refresh, Save, Run all, Run, and Cancel while running — move the buttons, enable rules, titles and handlers from `TopBar`'s `.cmd-cluster` unchanged, reading the **pane's** tab instead of the focused pane's. Background `color-mix(in srgb, <connection.color> 9%, transparent)`; all text `var(--text)` / `var(--text-2)`.
- `PaneEmpty`: with a connection — its dot, name, `EnvTag`, a "New query" button (`openQueryTab`) and the line "or double-click a table in the sidebar"; with `null` — "Select a connection in the sidebar".
- `TopBar` keeps: logo, a centred search button ("Search connections, tables, queries" + `⌘K`, `onClick={() => setPaletteOpen(true)}`), assistant, tunnels, settings, and the SSM "tunnel down" banner. It loses `ConnectionMenu`, the edit / diagram / Telescope / new-connection buttons and the whole `.cmd-cluster`.

- [ ] **Step 1: Build `EnvBar` and `PaneEmpty`; wire `EditorPane`.**
- [ ] **Step 2: Slim `TopBar`; delete `ConnectionMenu`; remove dead `.cmd-cluster` / connection-menu CSS.**
- [ ] **Step 3: Gates.**
- [ ] **Step 4: Verify in the running app:** ⌘↵ / ⌘⇧↵ / ⌘S still act on the focused pane; in a split view each pane's bar names its own connection and its Run button runs that pane's tab; a diagram tab shows tag and host without run buttons; Cancel appears while a query runs; selecting a connection with no tab shows `PaneEmpty`, not the dashboard; the dashboard still appears with zero tabs and via Home.
- [ ] **Step 5: Commit** — `feat(shell): per-pane environment bar carries the run controls`

---

### Task 8: Tab strip — pills and scope switch

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `visibleTabs`, `showScopeSwitch` (Task 4); store `tabScope`, `setTabScope` (Task 5).

- [ ] **Step 1: Replace the two-level strip.** Remove the `.tab-groups` row. The strip renders `visibleTabs(paneAllTabs, tabScope, activeConnectionId)`; every tab keeps its connection colour dot. Context-menu index maths (`menuIdx`, close left/right enablement) uses the same visible list.
- [ ] **Step 2: Scope switch.** At the right end of the strip, when `showScopeSwitch(paneAllTabs)`: two buttons **All tabs** / **This connection** with `aria-pressed`, calling `setTabScope`.
- [ ] **Step 3: Pill styling** with the tokens (`--control-h` height, `--radius-md`, `--gap` between pills, active pill on `--bg-3`); remove the dead `.tab-group*` rules. Drag-to-reorder drop indicators must still be visible between pills.
- [ ] **Step 4: Gates.**
- [ ] **Step 5: Verify in the running app:** with tabs on two connections the switch appears and filters; with one connection it is hidden; drag reorder and drag-to-split still work; "Close others" under **All tabs** closes other connections' tabs in that pane only; under **This connection** it leaves them.
- [ ] **Step 6: Commit** — `feat(tabs): single pill strip with an all/this-connection switch`

---

### Task 9: Right dock

**Files:**
- Create: `src/renderer/src/components/RightDock.tsx`
- Modify: `src/renderer/src/components/AssistantPanel.tsx`, `src/renderer/src/components/SsmPanel.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: store `dock`, `toggleAssistant`, `toggleSsm`, `closeDock`; `lib/assistant-width.ts` (unchanged — the dock reuses its width and key).
- Produces: `<RightDock />` — `App` renders it in place of `<AssistantPanel /><SsmPanel />`.

- [ ] **Step 1: Build `RightDock`.** It owns the `<aside>`, the left-edge resizer (move it out of `AssistantPanel`, same pointer/keyboard behaviour), and a header with two tab buttons **Assistant** / **Tunnels** (`aria-pressed`) and a Close button (`closeDock`). Renders nothing when `dock === null`.
- [ ] **Step 2: Make both panels content-only.** `AssistantPanel` and `SsmPanel` drop their own `<aside>`, close button and open check; `RightDock` mounts **both** while the dock is open and hides the inactive one with the `hidden` attribute, so SSM output keeps buffering while Assistant is showing.
- [ ] **Step 3: Dock chrome styles** with the tokens; the assistant thread and the tunnel list keep their current styles.
- [ ] **Step 4: Gates.**
- [ ] **Step 5: Verify in the running app:** the two top-bar buttons open / switch / close as in spec §5; resizing persists across restarts; start a tunnel, switch to Assistant, switch back — the output produced meanwhile is there.
- [ ] **Step 6: Commit** — `feat(shell): one right dock for assistant and tunnels`

---

### Task 10: Dashboard — filter, richer cards, one action row

**Files:**
- Modify: `src/renderer/src/lib/connection-groups.ts`, `src/renderer/src/lib/connection-groups.test.ts`, `src/renderer/src/components/Welcome.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `EnvTag`, `connectionModeText`, `groupTabs`, `startImport`, store `setTransferModal`.
- Produces:
  - `matchesConnection(c: Pick<ConnectionConfig, 'name' | 'host' | 'type'>, query: string): boolean`
  - `filterSections(sections: GroupSection[], query: string): GroupSection[]`

- [ ] **Step 1: Write the failing tests**

```ts
const c = { name: 'orders-prod', host: 'db.internal', type: 'postgres' }
expect(matchesConnection(c, '')).toBe(true)
expect(matchesConnection(c, '   ')).toBe(true)
expect(matchesConnection(c, 'ORDERS')).toBe(true)          // case-insensitive
expect(matchesConnection(c, 'internal')).toBe(true)        // host
expect(matchesConnection(c, 'postg')).toBe(true)           // engine
expect(matchesConnection(c, 'mysql')).toBe(false)
expect(matchesConnection(c, '.*')).toBe(false)             // plain text, not a pattern
expect(matchesConnection({ ...c, name: 'a(b' }, '(')).toBe(true)

// filterSections: blank query returns the input unchanged (empty groups kept — they are drop targets)
// a query keeps only matching connections; groups and subgroups left with none are removed
// a root group with no direct match but a matching subgroup is kept, with that subgroup
// a query matching nothing returns []
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/connection-groups.test.ts` — FAIL.
- [ ] **Step 3: Implement** both functions (substring match on lower-cased name, host and type).
- [ ] **Step 4: Rework `Welcome`.** One action row: filter input ("Filter by name, host or engine"), Import, Export, New group, New connection. Sections come from `filterSections(groupSections(...), filter)`; when that is empty and the filter is not blank, show "No connections match". While a filter is active, sections are not drop targets. Cards additionally show `EnvTag`, `connectionModeText`, and "N tab(s) open" from `groupTabs(tabs)`. Selection, double-click, edit, drag between groups, group rename / subgroup / delete are unchanged. Replace the ✎ and ⋯ glyphs with `Icon`s.
- [ ] **Step 5: Roomy dashboard styles** with the tokens: larger title, cards on `--bg-2` with `--radius-lg` and no border, groups as headings with space above, subgroups indented.
- [ ] **Step 6: Gates, verify in the running app** (filter narrows and restores; drag-and-drop still moves a card when the filter is blank; Import/Export open), **then commit** — `feat(dashboard): filter, richer cards and a single action row`

---

### Task 11: Roomy pass over the remaining shell regions

**Files:**
- Modify: `src/renderer/src/styles.css`; the components owning any glyph listed in Global Constraints among: `TopBar`, `StatusBar`, `ResultsPanel`, `QueryTab`, `ObjectTree`, `SavedSection`, `HistorySection`

Apply spec §7 to what Tasks 6–10 did not already restyle: top bar, object-tree / saved / history rows, results toolbar and grid, status bar.

- [ ] **Step 1: Move those regions onto the tokens** — font sizes to `--fs-base` / `--fs-sm` / `--fs-xs`, control and row heights to `--control-h` / `--row-h`, horizontal padding to `--pad-x`. In compact density each region must render as it does on `main` today (compare side by side before and after).
- [ ] **Step 2: Remove the 1px rules** between top bar, sidebar, tab strip and editor; separate by surface (`--bg` / `--bg-2` / `--bg-3`) and space. Inputs in these regions become filled and borderless.
- [ ] **Step 3: Results surface.** Results sit on a rounded `--bg-2` surface inside the content margin; drop the zebra striping; keep a hairline between rows; cell padding 12px/20px (comfortable) via tokens. The grid row height must equal `DENSITY_METRICS[density].gridRowHeight` so virtualisation stays aligned.
- [ ] **Step 4: Replace the listed glyphs with `Icon`s** in the files above.
- [ ] **Step 5: Gates.**
- [ ] **Step 6: Verify in the running app**, in **both densities** and in the Midnight, Daylight and one other dark theme: no clipped controls, no leftover hard-coded colours, results scroll smoothly with a large result, pending-edit highlights and the row inspector still line up with grid rows, the editor font follows the density.
- [ ] **Step 7: Commit** — `style(shell): roomy density across the shell, compact matches the old metrics`

---

### Task 12: Documentation and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** Update the Connect / Explore / Comfort feature bullets for: the connection sidebar and explorer, the environment label, the environment bar, the right dock, the density setting, the dashboard filter. Fix the shortcuts table if any description names the rail or the top-bar run buttons. Refresh the unit-test count.
- [ ] **Step 2: Dead code sweep.** Search for leftovers of removed pieces (`Rail`, `SidePanel`, `ConnectionMenu`, `assistantOpen`, `ssmOpen`, `.tab-groups`, `.cmd-cluster`, `.rail`) in `src/` and remove them.
- [ ] **Step 3: Full gates:** `npm run typecheck && npm run lint && npm test && npm run build` — all pass.
- [ ] **Step 4: Walk the spec's "How we will know it worked" list** in the running app and record the result of each line in the commit body.
- [ ] **Step 5: Commit** — `docs: README for the connection sidebar redesign`
