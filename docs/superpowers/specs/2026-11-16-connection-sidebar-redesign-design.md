# Connection sidebar redesign ("B2, roomy") — Design

**Date:** 2026-11-16
**Status:** Direction approved by the user from mocks; this document awaits approval.
**Reference mocks:** https://claude.ai/artifact/VU6dvnm842UvDx4ZK3FagM — the row "B mejorada":
`B2 aireada · más espacio visual` (the query screen, the look to match),
`B2 aireada · dashboard de conexiones` (the dashboard), and
`B2 · Barra plegada y panel derecho único` (collapsed sidebar + right dock; structure only —
restyle it to the roomy look). The mocks are static and use the Midnight theme.

## Intent

Ganesha's shell is being reorganised around **connections**. Today the user picks a connection
in a top-bar dropdown or by going back to the dashboard, panel toggles are split between the top
bar and the icon rail, the assistant and the SSM tunnels are two separate right-hand panels, and
the only sign of *which database a query will hit* is a small coloured dot.

The user keeps production, staging and local databases open at once and wants (their words,
across the conversation): to see their connections while working, to know at a glance which
environment they are in, and "más espacio visual" — a calmer, airier interface.

## Goals

1. Switching connection is one click from anywhere, without leaving the query screen.
2. The environment a query will run against is unmistakable (colour **and** text).
3. The interface breathes: fewer rules, larger hit targets, more padding.
4. One place for each kind of control; no two panels fighting for the right edge.
5. Keep everything the dashboard does today (groups, subgroups, drag-and-drop, export/import).

## Non-goals

- A workspace-per-connection model (direction "C" in the mocks). Not chosen.
- Moving the row inspector into the right dock. The mock shows a "Row" tab; leave the inspector
  where it is (`ResultsGrid`). *(My call — it keeps this project bounded.)*
- Showing pending cell edits in the environment bar (that belonged to direction C).
- Splitting `styles.css` into modules or extracting shared Modal/Menu components. Worth doing,
  but as its own project; do not mix it into this one.
- Resizing the split between the two sidebar zones by dragging.
- Any change to the main process beyond the two small data additions below.

## Anti-goals

- **Colour as the only environment signal.** Every environment cue carries text too.
- **Density with no way back.** Roomy is the default, but a compact setting must exist — fewer
  result rows per screen is a real cost in a database client.
- **Breaking muscle memory.** ⌘K, ⌘B, ⌘↵, ⌘⇧↵, ⌘S and tab drag-to-split keep working exactly
  as today.
- **Hard-coded colours.** All ten themes must look right; new styles use the existing theme
  tokens only.

## Constraints

- Electron + React + zustand + TanStack Query; one stylesheet (`src/renderer/src/styles.css`)
  driven by CSS custom properties per theme (`:root[data-theme=…]`).
- UI preferences that are per-machine live in `localStorage` through small pure libs with
  injectable storage (`lib/side-panel.ts`, `lib/assistant-width.ts`); app settings live in the
  sqlite `settings` table and reach the renderer as `AppSettings`.
- The tab model is already connection-centric: `lib/tab-groups.ts` derives groups from the flat
  `tabs` array, and the active connection *is* the active group. Keep that model.
- Run actions are looked up per tab through `lib/tab-actions.ts`; reuse it.
- Pure logic gets unit tests (Vitest, node env); the project has no component-render tests.

## Approaches considered

| | What | Trade-off |
|---|---|---|
| A · Unified shell | Keep rail + side panel, tidy the toggles, one right dock | Cheapest, but connections stay hidden behind a picker |
| **B2 · Connection sidebar (chosen)** | Sidebar lists connections above a per-connection explorer; environment bar over the editor; rail removed | Connections always visible; reuses today's tree/saved/history components; costs the rail |
| C · Workspace per connection | Each open connection is a top-level workspace | Strongest environment signal, but duplicates the tab-group model and was not chosen |

The user picked B after seeing an improved version (B2) and asked for the roomier variant.

## The design

### 1. Shell layout

```
┌ TopBar: brand · ⌘K search field · assistant / tunnels / settings ───────────────┐
├──────────────┬──────────────────────────────────────────────┬──────────────────┤
│ Sidebar      │ Tab strip (pills)                            │ Right dock       │
│  Connections │ Environment bar  [tag] mode · host   Run ▶   │  Assistant|Tunnels│
│  ──────────  │ Editor                                       │  (only when open)│
│  Explorer    │ Results (raised surface)                     │                  │
├──────────────┴──────────────────────────────────────────────┴──────────────────┤
│ StatusBar                                                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- `Rail` is **removed**. Its jobs move: dashboard → a Home button in the sidebar header;
  schema/saved/history → a segmented control in the explorer zone; schema diagram → an icon
  button in the explorer zone header (it stays in the ⌘K palette too); collapse → a button in
  the sidebar header (and ⌘B).
- `TopBar` keeps the brand, gains a centred search field that opens the existing command
  palette, and keeps the assistant / SSM / settings toggles on the right. It **loses** the
  connection picker, the edit-connection / diagram / telescope icon buttons and the run cluster.
  The Telescope button moves to the explorer zone header beside the diagram button (same
  visibility rule as today). "New connection" moves to the sidebar header. The SSM "tunnel down"
  banner that `TopBar` renders today stays where it is.

### 2. Sidebar

One resizable, collapsible `<aside>` replacing `Rail` + `SidePanel`. Width, open state and the
resize handle behave exactly as `SidePanel` does today (same keys in `lib/side-panel.ts`).

**Zone 1 — Connections.** Header: "Connections" label, Home, New connection, a `⋯` menu
(New group, Import…, Export…), Collapse. Below it, the connections grouped exactly as the
dashboard groups them (`lib/connection-groups.ts`): root groups, one level of subgroups, then
ungrouped. Groups are collapsible; which are collapsed persists in `localStorage`.

- A connection row shows: colour dot, name, environment tag (if set).
- **Click** selects the connection (`setActiveConnection`); the explorer zone follows.
  **Double-click** opens a new query tab on it. Same gestures as dashboard cards today.
- **Selecting a connection that has no tab in the focused pane** keeps the store model as it is
  (the pane's active tab becomes `null`), but the pane no longer shows the dashboard for that
  case. `EditorPane` shows a light empty state for the selected connection instead: its dot,
  name and environment tag, a "New query" button, and the hint "or double-click a table in the
  sidebar". The sidebar stays as it was. The dashboard appears only when there are no tabs at
  all or Home is pressed (the existing `tabs.length === 0 || dashboardOpen` rule in `App.tsx`).
  *(My call.)*
- Right-click offers Edit, Duplicate, Delete. Edit opens the connection modal; Duplicate and
  Delete reuse the hooks and behaviour of the modal's footer buttons today
  (`handleDuplicate` / `handleDelete` in `ConnectionModal.tsx`: confirm, clear the active
  connection, open the copy for editing).
- The zone takes at most ~45% of the sidebar height and scrolls on its own.
- Dragging connections between groups stays a dashboard feature; the sidebar list is not a
  drop target. *(My call.)*

**Zone 2 — Explorer.** Header: the active connection's dot and name, plus the diagram and
Telescope buttons. Then a segmented control **Schema · Saved · History** (this *is* the old
`sideSection`, same store field and persistence), then the existing `ObjectTree`,
`SavedSection` or `HistorySection` unchanged inside. With no active connection it shows the
existing "No connection selected" hint.

**Collapsed.** A narrow column: Expand button, Home, then one badge per connection that has
open tabs (derived with `groupTabs`), then a `+` that expands the sidebar. A badge shows two
initials over a bar in the connection's colour; its accessible name and tooltip are the
connection name; clicking it selects that connection. Initials: first letter of the first two
words of the name (split on anything non-alphanumeric), or the first two letters when there is
one word; uppercase. Put this in a pure, tested helper.

### 3. Tab strip

- One strip per pane, tabs drawn as rounded pills with a gap, each with its connection's colour
  dot before the title. The `+` new-tab button stays.
- A small switch at the right end: **All tabs · This connection**. "This connection" shows only
  the active connection's tabs (what the lower row of today's two-level strip shows); "All tabs"
  shows every tab in the pane. Default **All tabs**; persisted in `localStorage`. The switch is
  hidden when the pane's tabs all belong to one connection.
- Today's upper `.tab-groups` row is removed — the sidebar is the connection switcher now.
- Context-menu close actions (Close others / to the right / to the left / all) act on **the
  tabs the strip is showing**: every tab in the pane under "All tabs", only that connection's
  under "This connection" (which is what `applyPaneClose` in `lib/panes.ts` does today).
  *(My call.)*
- Tab behaviour is otherwise unchanged: rename, drag to reorder, drag to split.

### 4. Environment bar

A rounded bar directly under the tab strip of **each editor pane** (so a split view shows one
per pane, each for its own connection — this replaces the "focused pane" indirection the global
run cluster needs today).

- Left: environment tag (only if the connection has one), then one line of text —
  "Read-only — writes are blocked" (read-only), "Edits stage until you commit" (`requireCommit`),
  or nothing extra otherwise — then `engine · host:port` in muted text.
- Right: Refresh, Save, Run all, Run (⌘↵), and Cancel while running — the same buttons, enable
  rules and handlers the top-bar cluster has today, bound to **that pane's** active tab.
- The bar is tinted with the connection's colour at low opacity; the tag uses the same colour
  at higher opacity. Both must hold 4.5:1 text contrast in every theme — if a tinted background
  cannot guarantee that, keep text in `--text` and use the colour only for the tint and a dot.
- Shown only when the pane's active tab is a query tab; diagram / Telescope / table-info tabs
  show the tag and host but no run buttons.
- Keyboard shortcuts keep acting on the focused pane's active tab.

### 5. Right dock

`AssistantPanel` and `SsmPanel` stop being two siblings. One dock on the right holds both,
with a tab header **Assistant · Tunnels** and a close button.

- The top-bar assistant button opens the dock on Assistant (or closes it if it is already
  showing Assistant); the tunnels button does the same for Tunnels.
- One width for the dock, reusing the assistant's resizer and its persisted width.
- Each panel's own content and behaviour are unchanged. `SsmPanel`'s output buffering must
  keep working while the dock shows the other tab (today it only buffers while mounted — keep
  it mounted but hidden, or lift the buffer; builder's choice).
- Store: replace `assistantOpen` / `ssmOpen` with one field (which dock tab is open, or none).
  Keep `toggleAssistant` / `toggleSsm` as the actions so callers do not change.

### 6. Dashboard

`Welcome` stays the dashboard: shown when there are no tabs, and whenever Home is pressed.

- Restyled to the roomy look: larger title, cards on a raised surface with no borders, groups
  as headings with space above them, subgroups indented.
- One action row: filter field, Import, Export, New group, New connection. The filter matches
  name, host and engine, case-insensitively, and hides groups left empty by it.
- Cards additionally show the environment tag, the edit mode and how many tabs the connection
  has open. Everything they do today (select, open, edit, drag between groups) is unchanged.
- While the dashboard is showing, the sidebar **hides its Connections zone** and shows only the
  Explorer zone for the selected card (so the connection list is not on screen twice). Open /
  collapsed state, ⌘B, Expand and the resize handle behave normally. This keeps today's path of
  selecting a card, browsing its schema with no tab open, and double-clicking a table to open
  the first tab. *(My call — it differs from the dashboard mock, which drew the sidebar
  collapsed; forcing it collapsed left no way to reach the explorer with zero tabs.)*

### 7. Visual language ("roomy")

Introduce density tokens on `:root` — a three-step type scale (base / small / extra-small),
control height, row height, panel padding, gap, radius — and use them **only in the regions
this project rebuilds or restyles**: top bar, sidebar (including the rows of the object tree,
saved queries and history), tab strip, environment bar, results toolbar and grid, right-dock
chrome (header and tabs, not the assistant thread or tunnel list), status bar and dashboard.

Out of scope for restyling, and left on their current hard-coded sizes: modals, the command
palette, Telescope, table-info and diagram views, the row inspector, the assistant thread and
the SSM tunnel list. They will look denser than the shell until a follow-up. *(My call — the
stylesheet has ~177 hard-coded font sizes and no base size; tokenising all of it is the
separate CSS project.)*

Comfortable values, from the mock: type scale 14 / 13 / 12px (today those regions use mostly
13 / 12 / 11px); controls and sidebar rows 36px; tab pills 36px; 24px horizontal content
margin; editor padding 24px/40px; result cells 12px/20px with ~40px rows; radii 9–14px;
editor font 14px.

Two metrics live in JS and must follow the density too: the results virtualizer row estimate
(`ResultsGrid.tsx`, 26px today) and Monaco's `fontSize` (`MonacoEditor.tsx`, 13 today). Expose
the current density to the renderer through one small lib so both read the same values the CSS
tokens use.

- Regions are separated by a change of surface (`--bg` / `--bg-2` / `--bg-3`) and by space;
  remove the 1px rules between top bar, sidebar zones, tab strip and editor. Inputs become
  filled, borderless fields.
- Results sit on their own raised, rounded surface; drop the zebra striping, keep a hairline
  between rows.
- **Compact** density sets the same tokens to today's values for those regions (13 / 12 / 11px
  type, today's control heights and paddings, 26px result rows, 13px editor font). Layout and
  structure are identical in both densities; only token values differ.
- Glyph characters used as icons in the components this project touches (✎ ↻ ☆ ⋯ ＋ ✕ 🔒 🔭)
  are replaced with `Icon` SVGs; add the icons that are missing. Do not hunt for glyphs in
  components this project does not otherwise touch.

### 8. Data additions

**Environment label on a connection.** New optional text field `environment` (trimmed, at most
12 characters, stored as typed; empty = no tag).

- sqlite: `connections.environment TEXT NOT NULL DEFAULT ''`, added with `addColumnIfMissing`.
- `ConnectionInput.environment: string`; create / update / duplicate carry it.
- Connection modal: an "Environment" text field with suggestions PROD, STG, DEV, LOCAL
  (a datalist), next to the colour picker.
- Export / import (`connection-transfer.ts`): the field is written to the file and read back;
  a file without it imports as `''`. The file `version` stays 1 (the addition is optional and
  older builds ignore unknown fields).
- The tag is display-only. It changes no behaviour (read-only stays its own switch).

**Density setting.** `AppSettings.density: 'comfortable' | 'compact'`, default `'comfortable'`,
stored under the `density` settings key, validated like `theme`. Settings modal gets a
two-option control. Applied as `data-density` on `<html>` alongside `data-theme`, with the same
localStorage first-paint hint that `lib/theme.ts` uses for the theme.

## Decided by the user

- Direction B, in its improved two-zone form, with the environment bar borrowed from C.
- The roomier look ("más espacio visual").
- A dashboard view must exist.

## My calls (not yet confirmed by the user)

1. Environment is a new optional free-text field with suggestions, rather than derived from
   colour and mode alone.
2. A comfortable / compact density setting, comfortable by default.
3. Run buttons live in the per-pane environment bar, not the top bar.
4. The right dock holds Assistant and Tunnels only; the row inspector stays put.
5. "All tabs" is the default tab scope.
6. The sidebar list is not a drag-and-drop target; the dashboard keeps that.
7. On the dashboard the sidebar hides its Connections zone instead of collapsing (differs from
   the mock).
8. The CSS/module cleanup is a separate project.
9. Selecting a connection with no tab in the pane shows a light empty state, not the dashboard.
10. Tab close actions act on the tabs the strip is showing.
11. The roomy restyle covers the shell, sidebar, tab strip, environment bar, results, dock
    chrome, status bar and dashboard; modals, palette, Telescope, diagram, table info, row
    inspector and the assistant thread keep today's sizes for now.

## Left to the builder

- Component boundaries and file names for the new sidebar, environment bar and dock.
- Exact token names and the compact values (match today's rendering).
- How `SsmPanel` keeps buffering output while hidden.
- Which `localStorage` keys the new preferences use, following the `lib/side-panel.ts` pattern.
- Order of work, as long as each step leaves the app working and the suite green.
- README: update the shell description, shortcuts table if anything moved, and test counts.

## How we will know it worked

- With three connections open, switching between them never needs the dashboard or a dropdown.
- A read-only production connection is identifiable by text, not just colour, in the sidebar,
  the environment bar, the dashboard and — collapsed — by its badge's accessible name.
- Every existing shortcut and every tab / split gesture behaves as before.
- All ten themes and both densities render without hard-coded colours or clipped controls.
- Typecheck, lint, unit tests and build pass; new pure logic (initials, tab scope, dock state,
  density setting, environment field persistence and transfer) is unit-tested.
